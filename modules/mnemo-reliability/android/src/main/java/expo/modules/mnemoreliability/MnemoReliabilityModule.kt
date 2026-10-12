package expo.modules.mnemoreliability

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Reminder reliability checks and settings shortcuts for JS (lib/reliability.ts). */
class MnemoReliabilityModule : Module() {
  // An activity where there is one, so settings open on top of the app.
  private val context: Context
    get() = appContext.currentActivity ?: appContext.reactContext ?: throw Exceptions.ReactContextLost()

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
  }
}
