package expo.modules.raijintor

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import android.util.Log
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.torproject.jni.TorService

/**
 * Runs the embedded Tor daemon (Guardian Project tor-android) as a bound
 * service and reports its bootstrap progress. One instance per process.
 */
object TorController {
  private const val TAG = "RaijinTor"
  private const val START_TIMEOUT_MS = 180_000L
  private const val POLL_MS = 500L
  private val PROGRESS_RE = Regex("PROGRESS=(\\d+)")

  data class Status(val state: String, val progress: Int, val socksPort: Int, val error: String?)

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  @Volatile private var service: TorService? = null
  @Volatile private var connection: ServiceConnection? = null
  @Volatile private var pending: CompletableDeferred<Int>? = null
  @Volatile var status = Status("off", 0, 0, null)
    private set

  /** Called on every status change (from any thread). */
  @Volatile var listener: ((Status) -> Unit)? = null

  private fun update(next: Status) {
    status = next
    listener?.invoke(next)
  }

  /** Starts Tor if needed and returns the SOCKS port once bootstrapping is complete. */
  suspend fun start(context: Context): Int {
    val current = status
    if (current.state == "on" && current.socksPort > 0) return current.socksPort
    val deferred = synchronized(this) {
      pending ?: CompletableDeferred<Int>().also {
        pending = it
        bind(context.applicationContext, it)
      }
    }
    return deferred.await()
  }

  private fun bind(context: Context, deferred: CompletableDeferred<Int>) {
    update(Status("starting", 0, 0, null))
    val conn = object : ServiceConnection {
      override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
        service = (binder as? TorService.LocalBinder)?.service
        scope.launch { waitForBootstrap(context, deferred) }
      }

      override fun onServiceDisconnected(name: ComponentName?) {
        // The service process died; the next request starts it again.
        service = null
        synchronized(this@TorController) {
          connection = null
          pending = null
        }
        update(Status("off", 0, 0, null))
      }
    }
    connection = conn
    val bound = try {
      context.bindService(Intent(context, TorService::class.java), conn, Context.BIND_AUTO_CREATE)
    } catch (e: Exception) {
      Log.w(TAG, "bindService failed", e)
      false
    }
    if (!bound) fail(context, deferred, "Could not start Tor")
  }

  private suspend fun waitForBootstrap(context: Context, deferred: CompletableDeferred<Int>) {
    val deadline = System.currentTimeMillis() + START_TIMEOUT_MS
    var progress = 0
    while (System.currentTimeMillis() < deadline) {
      val tor = service ?: break
      // Both calls go through the control connection, which is not ready right away.
      val port = try { tor.getSocksPort() } catch (e: Exception) { 0 }
      val phase = try { tor.getInfo("status/bootstrap-phase") } catch (e: Exception) { null }
      val reported = phase?.let { PROGRESS_RE.find(it)?.groupValues?.get(1)?.toIntOrNull() }
      if (reported != null && reported != progress) {
        progress = reported
        update(Status("starting", progress, 0, null))
      }
      if (port > 0 && progress >= 100) {
        update(Status("on", 100, port, null))
        deferred.complete(port)
        return
      }
      delay(POLL_MS)
    }
    fail(context, deferred, "Tor did not finish starting in time")
  }

  private fun fail(context: Context, deferred: CompletableDeferred<Int>, message: String) {
    unbind(context)
    update(Status("error", 0, 0, message))
    deferred.completeExceptionally(IllegalStateException(message))
  }

  private fun unbind(context: Context) {
    val conn = synchronized(this) {
      val c = connection
      connection = null
      pending = null
      c
    }
    service = null
    if (conn != null) {
      try {
        context.applicationContext.unbindService(conn)
      } catch (e: Exception) {
        Log.w(TAG, "unbindService failed", e)
      }
    }
  }

  /** Stops Tor; unbinding the last client destroys the service, which shuts Tor down. */
  fun stop(context: Context) {
    val waiting = pending
    unbind(context)
    waiting?.completeExceptionally(IllegalStateException("Tor was stopped"))
    update(Status("off", 0, 0, null))
  }
}
