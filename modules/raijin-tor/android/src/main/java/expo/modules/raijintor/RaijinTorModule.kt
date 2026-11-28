package expo.modules.raijintor

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val STATUS_EVENT = "onStatus"
private const val WS_EVENT = "onWebSocket"
private const val SOCKET_EVENT = "onSocket"

class RaijinTorModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "React context unavailable", null)

  private fun statusMap(status: TorController.Status): Map<String, Any?> =
    mapOf(
      "state" to status.state,
      "progress" to status.progress,
      "socksPort" to status.socksPort,
      "error" to status.error,
    )

  override fun definition() = ModuleDefinition {
    Name("RaijinTor")

    Events(STATUS_EVENT, WS_EVENT, SOCKET_EVENT)

    OnCreate {
      TorController.listener = { status -> sendEvent(STATUS_EVENT, statusMap(status)) }
      NativeWebSockets.emit = { event -> sendEvent(WS_EVENT, event) }
      NativeSockets.emit = { event -> sendEvent(SOCKET_EVENT, event) }
    }

    OnDestroy {
      TorController.listener = null
      NativeWebSockets.emit = null
      NativeSockets.emit = null
    }

    Function("getStatus") {
      statusMap(TorController.status)
    }

    AsyncFunction("start") Coroutine { ->
      try {
        TorController.start(context)
      } catch (e: Exception) {
        throw CodedException("ERR_TOR_START", e.message ?: "Tor failed to start", e)
      }
    }

    Function("stop") {
      TorController.stop(context)
    }

    AsyncFunction("wsOpen") Coroutine { id: String, url: String, viaTor: Boolean, trustAll: Boolean ->
      val port = if (viaTor) {
        try {
          TorController.start(context)
        } catch (e: Exception) {
          throw CodedException("ERR_TOR_START", e.message ?: "Tor failed to start", e)
        }
      } else {
        0
      }
      NativeWebSockets.open(id, url, port, trustAll)
    }

    Function("wsSend") { id: String, text: String ->
      NativeWebSockets.send(id, text)
    }

    Function("wsClose") { id: String, code: Int, reason: String? ->
      NativeWebSockets.close(id, code, reason)
    }

    // Electrum: line-based TCP/TLS. Resolves with the server's TLS fingerprint ("" without TLS).
    AsyncFunction("socketOpen") Coroutine { id: String, host: String, port: Int, tls: Boolean, viaTor: Boolean, pin: String? ->
      val socksPort = if (viaTor) {
        try {
          TorController.start(context)
        } catch (e: Exception) {
          throw CodedException("ERR_TOR_START", e.message ?: "Tor failed to start", e)
        }
      } else {
        0
      }
      withContext(Dispatchers.IO) {
        try {
          NativeSockets.open(id, host, port, tls, socksPort, pin, if (viaTor) 60_000 else 15_000)
        } catch (e: Exception) {
          throw CodedException("ERR_SOCKET", e.message ?: e.javaClass.simpleName, e)
        }
      }
    }

    Function("socketSend") { id: String, line: String ->
      NativeSockets.send(id, line)
    }

    Function("socketClose") { id: String ->
      NativeSockets.close(id)
    }

    AsyncFunction("request") Coroutine { request: HttpRequest ->
      val port = if (request.viaTor) {
        try {
          TorController.start(context)
        } catch (e: Exception) {
          throw CodedException("ERR_TOR_START", e.message ?: "Tor failed to start", e)
        }
      } else {
        0
      }
      withContext(Dispatchers.IO) {
        try {
          NativeHttp.execute(request, port)
        } catch (e: Exception) {
          val reason = e.message ?: e.javaClass.simpleName
          throw CodedException("ERR_HTTP", reason, e)
        }
      }
    }
  }
}
