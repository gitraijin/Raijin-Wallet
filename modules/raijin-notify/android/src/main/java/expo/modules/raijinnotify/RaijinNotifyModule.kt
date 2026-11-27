package expo.modules.raijinnotify

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Local notifications for Raijin: one channel, one kind of message
 * ("payment received"). Shown by the app itself, never pushed by a server,
 * so it needs neither Firebase nor Google Play services.
 */
class RaijinNotifyModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "React context unavailable", null)

  override fun definition() = ModuleDefinition {
    Name("RaijinNotify")

    Function("setChannel") { id: String, name: String, color: String, vibration: List<Long> ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function
      val channel = NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH).apply {
        enableLights(true)
        lightColor = android.graphics.Color.parseColor(color)
        enableVibration(true)
        vibrationPattern = vibration.toLongArray()
      }
      context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    // Same result shape as expo's other permission calls: granted, canAskAgain, status.
    AsyncFunction("getPermission") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return@AsyncFunction promise.resolve(legacyPermission())
      val manager = appContext.permissions ?: return@AsyncFunction promise.reject(CodedException("ERR_NO_PERMISSIONS", "Permissions module unavailable", null))
      Permissions.getPermissionsWithPermissionsManager(manager, promise, Manifest.permission.POST_NOTIFICATIONS)
    }

    AsyncFunction("requestPermission") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return@AsyncFunction promise.resolve(legacyPermission())
      val manager = appContext.permissions ?: return@AsyncFunction promise.reject(CodedException("ERR_NO_PERMISSIONS", "Permissions module unavailable", null))
      Permissions.askForPermissionsWithPermissionsManager(manager, promise, Manifest.permission.POST_NOTIFICATIONS)
    }

    Function("show") { channelId: String, title: String, body: String ->
      show(channelId, title, body)
    }
  }

  /** Before Android 13 there is no runtime permission, only the user's switch in the system settings. */
  private fun legacyPermission(): Map<String, Any> {
    val enabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
    return mapOf("granted" to enabled, "canAskAgain" to false, "status" to if (enabled) "granted" else "denied", "expires" to "never")
  }

  @SuppressLint("MissingPermission") // checked right before notify()
  private fun show(channelId: String, title: String, body: String) {
    val ctx = context
    val manager = NotificationManagerCompat.from(ctx)
    if (!manager.areNotificationsEnabled()) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
    ) return

    // Tapping the notification opens (or brings back) the app.
    val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
    }
    val tap = launch?.let {
      PendingIntent.getActivity(ctx, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    val notification = NotificationCompat.Builder(ctx, channelId)
      .setSmallIcon(R.drawable.raijin_notification_icon)
      .setColor(ContextCompat.getColor(ctx, R.color.raijin_notification_color))
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setAutoCancel(true)
      .apply { if (tap != null) setContentIntent(tap) }
      .build()
    // A new id per message, so several payments stay visible side by side.
    manager.notify((System.currentTimeMillis() and 0x7fffffff).toInt(), notification)
  }
}
