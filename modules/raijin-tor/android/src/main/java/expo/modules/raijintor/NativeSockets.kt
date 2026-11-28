package expo.modules.raijintor

import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.Socket
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/**
 * Line-based TCP/TLS sockets for Electrum servers (Fulcrum, electrs): the
 * Electrum protocol is newline-delimited JSON-RPC over a raw connection,
 * which neither fetch nor WebSocket can do. Optional SOCKS (Tor, with DNS
 * resolved by Tor so .onion works).
 *
 * Electrum servers often use self-signed certificates, so a server can be
 * accepted by its certificate's SHA-256 fingerprint (trust on first use,
 * decided in JavaScript); "open" reports the fingerprint it saw.
 */
object NativeSockets {
  private class Conn(val socket: Socket, val out: OutputStream, val writer: ExecutorService)

  private val conns = ConcurrentHashMap<String, Conn>()
  var emit: ((Map<String, Any?>) -> Unit)? = null

  private fun event(id: String, type: String, vararg extra: Pair<String, Any?>) {
    emit?.invoke(mapOf("id" to id, "type" to type, *extra))
  }

  private val systemTrust: X509TrustManager by lazy {
    val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    factory.init(null as KeyStore?)
    factory.trustManagers.filterIsInstance<X509TrustManager>().first()
  }

  /**
   * Accepts a certificate if the system trusts it, or if its fingerprint is
   * the pinned one, or (pin "*") any certificate: the fingerprint is then
   * reported so JavaScript can pin it for next time.
   */
  private class FingerprintTrust(private val pin: String?) : X509TrustManager {
    var seen: String? = null

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
      throw CertificateException("Client certificates are not supported")
    }

    override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String) {
      val fp = fingerprint(chain[0])
      seen = fp
      if (pin == "*" || (pin != null && pin.equals(fp, ignoreCase = true))) return
      systemTrust.checkServerTrusted(chain, authType)
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = systemTrust.acceptedIssuers
  }

  fun fingerprint(cert: X509Certificate): String =
    MessageDigest.getInstance("SHA-256").digest(cert.encoded).joinToString("") { "%02x".format(it) }

  /** Connects (blocking; call off the main thread) and starts reading lines. Returns the TLS fingerprint or "". */
  fun open(id: String, host: String, port: Int, tls: Boolean, socksPort: Int, pin: String?, timeoutMs: Int): String {
    val raw = if (socksPort > 0) {
      Socket(Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", socksPort))).apply {
        connect(InetSocketAddress.createUnresolved(host, port), timeoutMs)
      }
    } else {
      Socket().apply { connect(InetSocketAddress(host, port), timeoutMs) }
    }
    raw.soTimeout = 0
    var fp = ""
    val socket: Socket = if (tls) {
      val trust = FingerprintTrust(pin)
      val ctx = SSLContext.getInstance("TLS")
      ctx.init(null, arrayOf(trust), null)
      val ssl = ctx.socketFactory.createSocket(raw, host, port, true) as SSLSocket
      ssl.soTimeout = timeoutMs
      try {
        ssl.startHandshake()
      } catch (e: Exception) {
        raw.close()
        // Tell JavaScript which certificate it was, so the user can decide.
        throw RuntimeException("TLS: ${e.message} (fingerprint ${trust.seen ?: "?"})", e)
      }
      ssl.soTimeout = 0
      fp = trust.seen ?: ""
      ssl
    } else {
      raw
    }
    val conn = Conn(socket, socket.getOutputStream(), Executors.newSingleThreadExecutor())
    conns[id] = conn
    Thread({
      try {
        val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8), 64 * 1024)
        while (true) {
          val line = reader.readLine() ?: break
          if (line.isNotEmpty()) event(id, "data", "data" to line)
        }
        event(id, "close", "reason" to "")
      } catch (e: Exception) {
        if (conns.containsKey(id)) event(id, "close", "reason" to (e.message ?: e.javaClass.simpleName))
      } finally {
        conns.remove(id)?.let { shutdown(it) }
      }
    }, "raijin-socket-$id").apply { isDaemon = true }.start()
    return fp
  }

  /** Sends one line (a newline is added). False when the socket is gone. */
  fun send(id: String, line: String): Boolean {
    val conn = conns[id] ?: return false
    conn.writer.execute {
      try {
        conn.out.write((line + "\n").toByteArray(Charsets.UTF_8))
        conn.out.flush()
      } catch (e: Exception) {
        close(id)
        event(id, "close", "reason" to (e.message ?: "write failed"))
      }
    }
    return true
  }

  fun close(id: String) {
    conns.remove(id)?.let { shutdown(it) }
  }

  private fun shutdown(conn: Conn) {
    try {
      conn.socket.close()
    } catch (_: Exception) {
    }
    conn.writer.shutdownNow()
  }
}
