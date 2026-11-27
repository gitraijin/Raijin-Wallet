package expo.modules.raijintor

import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * WebSockets over Tor for NWC relays (nostr). JavaScript's WebSocket cannot
 * use a SOCKS proxy, so the app opens them here and gets events back
 * ("open" / "message" / "close" / "error", keyed by a socket id).
 */
object NativeWebSockets {
  private val sockets = ConcurrentHashMap<String, WebSocket>()
  var emit: ((Map<String, Any?>) -> Unit)? = null

  private fun event(id: String, type: String, vararg extra: Pair<String, Any?>) {
    emit?.invoke(mapOf("id" to id, "type" to type, *extra))
  }

  fun open(id: String, url: String, socksPort: Int, trustAll: Boolean) {
    val client = NativeHttp.client(socksPort, null, trustAll, 60_000)
      .newBuilder()
      .readTimeout(0, TimeUnit.MILLISECONDS) // long-lived connection
      .callTimeout(0, TimeUnit.MILLISECONDS)
      .pingInterval(30, TimeUnit.SECONDS)
      .build()
    val socket = client.newWebSocket(
      Request.Builder().url(url).build(),
      object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) = event(id, "open")

        override fun onMessage(webSocket: WebSocket, text: String) = event(id, "message", "data" to text)

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
          webSocket.close(code, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          sockets.remove(id)
          event(id, "close", "code" to code, "reason" to reason)
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
          sockets.remove(id)
          event(id, "error", "reason" to (t.message ?: t.javaClass.simpleName))
          event(id, "close", "code" to 1006, "reason" to (t.message ?: ""))
        }
      },
    )
    sockets[id] = socket
  }

  fun send(id: String, text: String): Boolean = sockets[id]?.send(text) ?: false

  fun close(id: String, code: Int, reason: String?) {
    sockets.remove(id)?.close(code, reason)
  }
}
