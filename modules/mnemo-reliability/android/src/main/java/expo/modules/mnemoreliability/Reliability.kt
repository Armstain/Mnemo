package expo.modules.mnemoreliability

import android.app.ActivityManager
import android.app.AlarmManager
import android.app.AppOpsManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.provider.Settings

/**
 * What can stop a reminder reaching someone on this phone, and the settings
 * screens that fix it. Phone makers (Xiaomi, Oppo, Vivo, Huawei, Transsion…)
 * add their own battery managers on top of Android's, with settings in
 * different places on each; every opener here tries the maker's screen first
 * and falls back to the app's own Android settings.
 */
object Reliability {
  // First word only: Transsion phones say "INFINIX MOBILITY LIMITED".
  private val maker: String get() = Build.MANUFACTURER.trim().lowercase().substringBefore(' ')

  fun status(context: Context): Map<String, Any?> {
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    val activities = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    return mapOf(
      "manufacturer" to maker,
      "brand" to Build.BRAND.lowercase(),
      "sdk" to Build.VERSION.SDK_INT,
      // Below Android 12 every app may set exact alarms.
      "exactAlarms" to (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()),
      // Android's own battery optimization ("Unrestricted" in app info).
      "batteryUnrestricted" to power.isIgnoringBatteryOptimizations(context.packageName),
      // "Restricted" battery use: no background work at all.
      "backgroundRestricted" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && activities.isBackgroundRestricted),
      "autostart" to autostart(context),
    )
  }

  /**
   * Xiaomi's Autostart switch, which also decides whether reminders come back
   * after a restart. MIUI keeps it as app op 10008; null where that can't be
   * read (other makers, or a MIUI that moved it).
   */
  private fun autostart(context: Context): Boolean? {
    if (maker != "xiaomi") return null
    return try {
      val ops = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
      val check = AppOpsManager::class.java.getMethod(
        "checkOpNoThrow",
        Int::class.javaPrimitiveType,
        Int::class.javaPrimitiveType,
        String::class.java,
      )
      check.invoke(ops, 10008, Process.myUid(), context.packageName) as Int == AppOpsManager.MODE_ALLOWED
    } catch (e: Exception) {
      null
    }
  }

  private fun packageUri(context: Context): Uri = Uri.parse("package:${context.packageName}")

  private fun appDetails(context: Context) =
    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri(context))

  private fun component(pkg: String, cls: String) = Intent().setComponent(ComponentName(pkg, cls))

  /** Starts the first of `intents` that exists. True if one opened. */
  private fun launch(context: Context, intents: List<Intent>): Boolean {
    for (intent in intents) {
      try {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
      } catch (e: Exception) {
        // Not on this phone (ActivityNotFoundException) or not allowed
        // (SecurityException); try the next.
      }
    }
    return false
  }

  /** "Alarms & reminders" for this app (Android 12+). */
  fun openExactAlarms(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return launch(context, listOf(appDetails(context)))
    return launch(
      context,
      listOf(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, packageUri(context)), appDetails(context)),
    )
  }

  /** Where this app's battery use is set to "No restrictions" / "Unrestricted". */
  fun openBattery(context: Context): Boolean {
    val label = context.applicationInfo.loadLabel(context.packageManager).toString()
    val intents = mutableListOf<Intent>()
    if (maker == "xiaomi") {
      intents += component("com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity")
        .putExtra("package_name", context.packageName)
        .putExtra("package_label", label)
    }
    intents += appDetails(context)
    intents += Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
    return launch(context, intents)
  }

  /** The maker's autostart / background start manager, where there is one. */
  fun openAutostart(context: Context): Boolean {
    val intents = when (maker) {
      "xiaomi" -> listOf(
        component("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
      )
      "oppo", "realme", "oneplus" -> listOf(
        component("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
        component("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
        component("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
        component("com.oplus.battery", "com.oplus.startupapp.view.StartupAppListActivity"),
      )
      "vivo", "iqoo" -> listOf(
        component("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
        component("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"),
        component("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"),
      )
      "huawei", "honor" -> listOf(
        component("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
        component("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"),
        component("com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
      )
      "infinix", "tecno", "itel" -> listOf(
        component("com.transsion.phonemaster", "com.cyin.himgr.autostart.AutoStartActivity"),
      )
      "asus" -> listOf(
        component("com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity"),
      )
      else -> emptyList()
    }
    return launch(context, intents + appDetails(context))
  }

  /** This app's notification settings (pop-up, lock screen, sound). */
  fun openNotifications(context: Context): Boolean {
    val intents = mutableListOf<Intent>()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      intents += Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
    }
    intents += appDetails(context)
    return launch(context, intents)
  }
}
