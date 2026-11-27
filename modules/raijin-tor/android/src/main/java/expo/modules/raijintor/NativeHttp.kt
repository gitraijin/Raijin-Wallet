package expo.modules.raijintor

import android.util.Base64
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.internal.tls.OkHostnameVerifier
import java.io.ByteArrayInputStream
import java.net.InetSocketAddress
import java.net.Proxy
import java.security.KeyStore
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

class HttpRequest : Record {
  @Field var url: String = ""
  @Field var method: String = "GET"
  @Field var headers: Map<String, String> = emptyMap()
  @Field var body: String? = null
  @Field var timeoutMs: Int = 30_000
  /** Route through the embedded Tor daemon (started on demand). */
  @Field var viaTor: Boolean = false
  /** DER certificate (standard base64) to accept in addition to the system CAs. */
  @Field var certBase64: String? = null
  /** Accept any certificate. Only for .onion hosts, where the address authenticates the server. */
  @Field var trustAllCerts: Boolean = false
  /** Return after the first non-empty line (for endless newline-delimited JSON streams). */
  @Field var firstLineOnly: Boolean = false
}

/**
 * HTTP client for node connections: optional SOCKS proxy (Tor, with DNS
 * resolved by Tor so .onion works) and optional trust in the node's own
 * self-signed certificate from the lndconnect string.
 */
object NativeHttp {
  private val clients = ConcurrentHashMap<String, OkHttpClient>()
  private val base = OkHttpClient()

  private val systemTrust: X509TrustManager by lazy {
    val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    factory.init(null as KeyStore?)
    factory.trustManagers.filterIsInstance<X509TrustManager>().first()
  }

  /** Trusts the pinned certificate, everything else via the system CAs. */
  private class PinnedOrSystemTrust(private val pinned: X509Certificate?, private val system: X509TrustManager?) :
    X509TrustManager {
    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
      throw CertificateException("Client certificates are not supported")
    }

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
      if (chain.isNullOrEmpty()) throw CertificateException("Empty certificate chain")
      if (pinned != null && chain[0].encoded.contentEquals(pinned.encoded)) return
      if (system == null) return // trust-all mode (.onion only)
      system.checkServerTrusted(chain, authType)
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = system?.acceptedIssuers ?: emptyArray()
  }

  private fun parseCert(base64: String): X509Certificate {
    val der = Base64.decode(base64, Base64.DEFAULT)
    return CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(der)) as X509Certificate
  }

  internal fun client(socksPort: Int, certBase64: String?, trustAll: Boolean, timeoutMs: Int): OkHttpClient {
    val key = "$socksPort|${certBase64?.hashCode()}|$trustAll|$timeoutMs"
    return clients.getOrPut(key) {
      val builder = base.newBuilder()
        .connectTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
        .readTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
        .callTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
      if (socksPort > 0) {
        // OkHttp hands unresolved host names to a SOCKS proxy, so Tor does the DNS.
        builder.proxy(Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", socksPort)))
      }
      if (trustAll || certBase64 != null) {
        val pinned = certBase64?.let { parseCert(it) }
        val trust = PinnedOrSystemTrust(pinned, if (trustAll) null else systemTrust)
        val ssl = SSLContext.getInstance("TLS")
        ssl.init(null, arrayOf(trust), null)
        builder.sslSocketFactory(ssl.socketFactory, trust)
        builder.hostnameVerifier(
          HostnameVerifier { host, session ->
            if (trustAll) return@HostnameVerifier true
            // The node's own certificate rarely names the host it is reached by.
            val leaf = session.peerCertificates.firstOrNull() as? X509Certificate
            if (pinned != null && leaf != null && leaf.encoded.contentEquals(pinned.encoded)) {
              true
            } else {
              OkHostnameVerifier.verify(host, session)
            }
          },
        )
      }
      builder.build()
    }
  }

  fun execute(request: HttpRequest, socksPort: Int): Map<String, Any> {
    val client = client(socksPort, request.certBase64, request.trustAllCerts, request.timeoutMs)
    val method = request.method.uppercase()
    val body = request.body?.toRequestBody("application/json; charset=utf-8".toMediaType())
      ?: if (method == "POST" || method == "PUT") ByteArray(0).toRequestBody(null) else null
    val builder = Request.Builder().url(request.url).method(method, body)
    request.headers.forEach { (name, value) -> builder.header(name, value) }

    val call = client.newCall(builder.build())
    call.execute().use { response ->
      val responseBody = response.body ?: return mapOf("status" to response.code, "body" to "")
      if (request.firstLineOnly && response.isSuccessful) {
        val source = responseBody.source()
        while (true) {
          val line = source.readUtf8Line() ?: break
          if (line.isNotBlank()) {
            call.cancel() // the stream would only end once the operation completes
            return mapOf("status" to response.code, "body" to line)
          }
        }
        return mapOf("status" to response.code, "body" to "")
      }
      return mapOf("status" to response.code, "body" to responseBody.string())
    }
  }
}
