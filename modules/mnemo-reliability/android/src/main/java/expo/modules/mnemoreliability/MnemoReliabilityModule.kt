package expo.modules.mnemoreliability

import android.content.Context
import expo.modules.interfaces.taskManager.TaskManagerInterface
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Reminder reliability checks and settings shortcuts for JS (lib/reliability.ts). */
class MnemoReliabilityModule : Module() {
  // An activity where there is one, so settings open on top of the app.
  private val context: Context
    get() = appContext.currentActivity ?: appContext.reactContext ?: throw Exceptions.ReactContextLost()

  // The app's own context, for what must outlive a screen (geofence outcomes).
  private val appContextOrNull: Context?
    get() = appContext.reactContext?.applicationContext

  // expo-task-manager, which delivers geofence events to the JS task and restores it after a restart.
  private val taskManager: TaskManagerInterface?
    get() = appContext.legacyModule<TaskManagerInterface>()

  private fun stopGeofencing(taskName: String) {
    val manager = taskManager ?: return
    if (!manager.taskHasConsumerOfClass(taskName, MnemoGeofencingConsumer::class.java)) return
    try {
      manager.unregisterTask(taskName, MnemoGeofencingConsumer::class.java)
    } catch (e: Exception) {
      // Already gone.
    }
    val ctx = appContextOrNull ?: return
    GeofenceOutcomes.record(ctx, "off", 0, restored = false)
  }

  override fun definition() = ModuleDefinition {
    Name("MnemoReliability")

    Function("status") {
      return@Function Reliability.status(context)
    }

    Function("openExactAlarms") {
      return@Function Reliability.openExactAlarms(context)
    }

    Function("openBattery") {
      return@Function Reliability.openBattery(context)
    }

    Function("openAutostart") {
      return@Function Reliability.openAutostart(context)
    }

    Function("openNotifications") {
      return@Function Reliability.openNotifications(context)
    }

    // ─── Geofences (lib/geofence-native.ts) ────────────────────────
    // Registered through expo-task-manager with MnemoGeofencingConsumer, which records Android's
    // answer. Resolves with that answer, or `unknown` after 10 s.
    AsyncFunction("startGeofencing") { taskName: String, regions: List<Map<String, Any?>>, promise: Promise ->
      val manager = taskManager
      val ctx = appContextOrNull
      if (manager == null || ctx == null) {
        promise.resolve(mapOf("state" to "failed", "message" to "Task manager not available"))
        return@AsyncFunction
      }
      GeofenceOutcomes.await { promise.resolve(it) }
      GeofenceOutcomes.fromApp = true
      try {
        val options = HashMap<String, Any>()
        options["regions"] = ArrayList(regions.map { HashMap(it) })
        manager.registerTask(taskName, MnemoGeofencingConsumer::class.java, options)
      } catch (e: Exception) {
        GeofenceOutcomes.fromApp = false
        GeofenceOutcomes.record(ctx, "failed", regions.size, restored = false, message = e.message)
      }
    }

    AsyncFunction("stopGeofencing") { taskName: String ->
      stopGeofencing(taskName)
    }

    Function("hasStartedGeofencing") { taskName: String ->
      return@Function taskManager?.taskHasConsumerOfClass(taskName, MnemoGeofencingConsumer::class.java) ?: false
    }

    Function("geofenceOutcome") {
      return@Function appContextOrNull?.let { GeofenceOutcomes.read(it) }
    }

    Function("buzz") { pattern: List<Double> ->
      return@Function Reliability.buzz(context, pattern.map { it.toLong() }.toLongArray())
    }
  }
}
