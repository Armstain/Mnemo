package expo.modules.mnemoreliability

import android.Manifest
import android.app.PendingIntent
import android.app.job.JobParameters
import android.app.job.JobService
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.PersistableBundle
import android.util.Log
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofenceStatusCodes
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingEvent
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import expo.modules.interfaces.taskManager.TaskConsumer
import expo.modules.interfaces.taskManager.TaskConsumerInterface
import expo.modules.interfaces.taskManager.TaskInterface
import expo.modules.interfaces.taskManager.TaskManagerUtilsInterface

/**
 * Mnemo's geofences, registered through expo-task-manager like expo-location's own
 * GeofencingTaskConsumer (same event delivery to the `mnemo-geofence` JS task, same restore
 * after a restart), with the part expo-location leaves out: Android's answer. Every
 * registration records an outcome (GeofenceOutcomes), success or the reason it failed.
 * See docs/plans/2026-11-root-fixes.md, A.
 *
 * The task manager stores this class's name and re-creates it by reflection after a restart:
 * keep the name, and the keep rule in proguard-rules.pro.
 */
class MnemoGeofencingConsumer(context: Context, taskManagerUtils: TaskManagerUtilsInterface?) :
  TaskConsumer(context, taskManagerUtils), TaskConsumerInterface {

  private var task: TaskInterface? = null
  private var pendingIntent: PendingIntent? = null
  private var client: GeofencingClient? = null
  private var regions: MutableMap<String, PersistableBundle> = HashMap()

  override fun taskType(): String = "geofencing"

  override fun didRegister(task: TaskInterface) {
    this.task = task
    start()
  }

  override fun didUnregister() {
    stop()
    task = null
    pendingIntent = null
    client = null
    regions.clear()
  }

  override fun setOptions(options: Map<String, Any>) {
    super.setOptions(options)
    stop()
    start()
  }

  override fun didReceiveBroadcast(intent: Intent) {
    val event = GeofencingEvent.fromIntent(intent) ?: return
    if (event.hasError()) {
      // Android stopped watching (usually "not available": location accuracy turned off). Its
      // geofences are gone until set again; say so, and tell the JS task as expo-location does.
      val code = event.errorCode
      context?.let { GeofenceOutcomes.record(it, "dropped", regions.size, restored = false, code = code, message = errorText(code)) }
      task?.execute(null, Error(errorText(code)))
      return
    }
    val eventType = when (event.geofenceTransition) {
      Geofence.GEOFENCE_TRANSITION_ENTER -> EVENT_ENTER
      Geofence.GEOFENCE_TRANSITION_EXIT -> EVENT_EXIT
      else -> return
    }
    val state = if (eventType == EVENT_ENTER) STATE_INSIDE else STATE_OUTSIDE
    val ctx = context?.applicationContext ?: return
    for (geofence in event.triggeringGeofences ?: return) {
      val region = regions[geofence.requestId] ?: continue
      region.putInt("state", state)
      val data = PersistableBundle()
      data.putInt("eventType", eventType)
      data.putPersistableBundle("region", region)
      taskManagerUtils.scheduleJob(ctx, task, listOf(data))
    }
  }

  override fun didExecuteJob(jobService: JobService, params: JobParameters): Boolean {
    val current = task ?: return false
    for (item in taskManagerUtils.extractDataFromJobParams(params)) {
      val region = Bundle()
      region.putAll(item.getPersistableBundle("region"))
      val bundle = Bundle()
      bundle.putInt("eventType", item.getInt("eventType"))
      bundle.putBundle("region", region)
      current.execute(bundle, null) { jobService.jobFinished(params, false) }
    }
    // Still running: the callback above finishes the job once JS is done.
    return true
  }

  private fun start() {
    val ctx = context?.applicationContext ?: return
    val restored = !GeofenceOutcomes.fromApp
    GeofenceOutcomes.fromApp = false

    val fences = ArrayList<Geofence>()
    regions = HashMap()
    val list = (task?.options?.get("regions") as? List<*>).orEmpty().mapNotNull { it as? Map<*, *> }
    for (r in list) {
      val id = r["identifier"] as? String ?: continue
      val latitude = (r["latitude"] as? Number)?.toDouble() ?: continue
      val longitude = (r["longitude"] as? Number)?.toDouble() ?: continue
      val radius = (r["radius"] as? Number)?.toFloat() ?: continue
      fences.add(
        Geofence.Builder()
          .setRequestId(id)
          .setCircularRegion(latitude, longitude, radius)
          .setExpirationDuration(Geofence.NEVER_EXPIRE)
          .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT)
          .build(),
      )
      regions[id] = PersistableBundle().apply {
        putString("identifier", id)
        putDouble("latitude", latitude)
        putDouble("longitude", longitude)
        putDouble("radius", radius.toDouble())
        putInt("state", STATE_UNKNOWN)
      }
    }

    if (fences.isEmpty()) return GeofenceOutcomes.record(ctx, "off", 0, restored)
    if (!permitted(ctx)) return GeofenceOutcomes.record(ctx, "no-permission", fences.size, restored)
    if (!locationOn(ctx)) return GeofenceOutcomes.record(ctx, "no-provider", fences.size, restored)

    val intent = taskManagerUtils.createTaskIntent(ctx, task)
    val request = GeofencingRequest.Builder()
      .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER or GeofencingRequest.INITIAL_TRIGGER_EXIT)
      .addGeofences(fences)
      .build()
    val geofencing = LocationServices.getGeofencingClient(ctx)
    pendingIntent = intent
    client = geofencing
    try {
      geofencing.addGeofences(request, intent)
        .addOnSuccessListener { GeofenceOutcomes.record(ctx, "ok", fences.size, restored) }
        .addOnFailureListener { e ->
          val code = (e as? ApiException)?.statusCode
          Log.w(TAG, "Android refused the geofences", e)
          GeofenceOutcomes.record(ctx, "refused", fences.size, restored, code, errorText(code))
        }
    } catch (e: SecurityException) {
      GeofenceOutcomes.record(ctx, "no-permission", fences.size, restored, message = e.message)
    }
  }

  private fun stop() {
    pendingIntent?.let {
      client?.removeGeofences(it)
      it.cancel()
    }
    pendingIntent = null
  }

  private fun permitted(ctx: Context): Boolean {
    val fine = ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    val background = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
      ctx.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
    return fine && background
  }

  private fun locationOn(ctx: Context): Boolean {
    val manager = ctx.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return true
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      manager.isLocationEnabled
    } else {
      manager.isProviderEnabled(LocationManager.GPS_PROVIDER) || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    }
  }

  companion object {
    private const val TAG = "MnemoGeofencing"

    // The values expo-location's JS (GeofencingEventType, GeofencingRegionState) uses, which
    // lib/geofence-task.ts reads: the events reach JS exactly as before.
    private const val EVENT_ENTER = 1
    private const val EVENT_EXIT = 2
    private const val STATE_UNKNOWN = 0
    private const val STATE_INSIDE = 1
    private const val STATE_OUTSIDE = 2

    fun errorText(code: Int?): String = when (code) {
      GeofenceStatusCodes.GEOFENCE_NOT_AVAILABLE -> "Geofencing not available."
      GeofenceStatusCodes.GEOFENCE_TOO_MANY_GEOFENCES -> "Too many geofences."
      GeofenceStatusCodes.GEOFENCE_TOO_MANY_PENDING_INTENTS -> "Too many pending intents."
      // GEOFENCE_INSUFFICIENT_LOCATION_PERMISSION, GEOFENCE_REQUEST_TOO_FREQUENT: by value, as
      // older Play Services builds don't name them.
      1004 -> "Insufficient location permission."
      1005 -> "Requests too frequent."
      null -> "Unknown geofencing error."
      else -> "Geofencing error $code."
    }
  }
}
