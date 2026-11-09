package expo.modules.mnemoreliability

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

/**
 * What Android answered the last time Mnemo's geofences were set (MnemoGeofencingConsumer), kept
 * in SharedPreferences so it survives the app closing and the phone restarting: JS reads it on
 * opening (lib/geofence-native.ts) and shows it in Settings → Location and the problem report.
 *
 * States: ok, refused (Play Services said no; `code` is its GeofenceStatusCodes value),
 * no-permission, no-provider (location off), dropped (Android stopped watching later),
 * failed (registering the task threw), off (nothing to watch).
 */
object GeofenceOutcomes {
  private const val PREFS = "mnemo.geofence"
  private const val KEY = "outcome"
  private const val WAIT_MS = 10_000L

  /**
   * Set by the module just before it registers. A registration without it was started by the
   * task manager restoring the task (after a restart, an update, or the app starting in the
   * background), which JS never sees otherwise.
   */
  @Volatile var fromApp = false

  private val waiting = mutableListOf<(Map<String, Any?>) -> Unit>()
  private val main = Handler(Looper.getMainLooper())

  fun record(context: Context, state: String, count: Int, restored: Boolean, code: Int? = null, message: String? = null) {
    val json = JSONObject().apply {
      put("state", state)
      put("count", count)
      put("at", System.currentTimeMillis().toDouble())
      put("restored", restored)
      if (code != null) put("code", code)
      if (message != null) put("message", message)
    }
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY, json.toString())
      .apply()
    val outcome = toMap(json)
    val callbacks = synchronized(waiting) { waiting.toList().also { waiting.clear() } }
    callbacks.forEach { it(outcome) }
  }

  fun read(context: Context): Map<String, Any?>? {
    val raw = context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY, null) ?: return null
    return try {
      toMap(JSONObject(raw))
    } catch (e: Exception) {
      null
    }
  }

  /**
   * Calls back once, with the next outcome recorded, or `unknown` if Android hasn't answered in
   * WAIT_MS. Called before registering, so a fast answer isn't missed.
   */
  fun await(callback: (Map<String, Any?>) -> Unit) {
    var answered = false
    lateinit var once: (Map<String, Any?>) -> Unit
    once = { outcome ->
      val first = synchronized(waiting) {
        waiting.remove(once)
        if (answered) false else true.also { answered = true }
      }
      if (first) callback(outcome)
    }
    synchronized(waiting) { waiting.add(once) }
    main.postDelayed({ once(mapOf("state" to "unknown", "at" to System.currentTimeMillis().toDouble())) }, WAIT_MS)
  }

  private fun toMap(json: JSONObject): Map<String, Any?> =
    json.keys().asSequence().associateWith { key -> json.get(key) }
}
