package com.lift.workoutlive

import android.Manifest
import android.content.Context
import android.os.Build
import androidx.core.os.bundleOf
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The JavaScript surface.
 *
 * A renderer, a queue and a doorbell. Everything about *what* a session is — which
 * exercise, how many sets, how long the rest — is decided in TypeScript against
 * SQLite and the timer store, and arrives here already rendered into strings and
 * epochs. Nothing in this module knows what a workout is, and nothing in it can
 * change one.
 *
 * That division is the point. The app has exactly one description of the current
 * session, in `features/workouts/workout-notice.tsx`, and this is a renderer for
 * it.
 */
class WorkoutLiveModule : Module() {

  companion object {
    /**
     * The module while JavaScript is attached, for `WorkoutLiveReceiver` to ring.
     *
     * Null between a reload and the next `OnCreate`, and null in a process that
     * Android started only to deliver a broadcast. Both cases are why the press
     * is written to `PendingActions` before this is consulted.
     */
    @Volatile
    private var active: WorkoutLiveModule? = null

    fun announcePendingActions() {
      // Swallowing is deliberate: the press is already on disk. Failing to ring
      // the doorbell costs latency, not the action.
      runCatching { active?.emitPendingActions() }
    }

    internal const val EVENT_PENDING = "onPendingActions"
  }

  private fun emitPendingActions() {
    sendEvent(EVENT_PENDING, bundleOf())
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("WorkoutLive")

    Events(EVENT_PENDING)

    OnCreate {
      active = this@WorkoutLiveModule
      WorkoutLiveNotification.ensureChannel(context)
    }

    OnDestroy {
      // Only if we are still the current one. A fast reload can construct the
      // replacement before tearing down the old module, and clearing then would
      // silence the receiver for the rest of the session.
      if (active === this@WorkoutLiveModule) active = null
    }

    /**
     * Whether the notification can be posted, and whether it can be backed by a
     * foreground service.
     *
     * Two separate answers because they degrade separately: without
     * POST_NOTIFICATIONS there is nothing to show at all, whereas without
     * ACTIVITY_RECOGNITION there is a notification that simply is not protected
     * from being killed in the background.
     */
    Function("getPermissionStatus") {
      bundleOf(
        "canPost" to hasPermission(Manifest.permission.POST_NOTIFICATIONS, sinceApi = 33),
        "canRunService" to hasPermission(Manifest.permission.ACTIVITY_RECOGNITION, sinceApi = 34),
      )
    }

    /**
     * Asks for ACTIVITY_RECOGNITION, the runtime half of the `health`
     * foreground-service type.
     *
     * Resolves true where the permission is not required at all, so the caller
     * never has to know which Android version it is on.
     */
    AsyncFunction("requestServicePermission") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        promise.resolve(true)
        return@AsyncFunction
      }

      val permissions = appContext.permissions
      if (permissions == null) {
        promise.resolve(false)
        return@AsyncFunction
      }

      permissions.askForPermissions(
        { response ->
          val granted =
            response[Manifest.permission.ACTIVITY_RECOGNITION]?.status == PermissionsStatus.GRANTED
          promise.resolve(granted)
        },
        Manifest.permission.ACTIVITY_RECOGNITION,
      )
    }

    /**
     * Draws the session. The only verb — there is no separate "start".
     *
     * Whether this needs to raise the service or merely redraw is something the
     * native side can answer for certain and the JavaScript side can only track,
     * so it is answered here. That matters beyond tidiness: a service *can* go
     * away mid-session while the app carries on (the platform refuses a
     * background start, or the user revoked ACTIVITY_RECOGNITION from settings),
     * and a caller holding its own "already started" flag would spend the rest
     * of the workout posting into a service that no longer exists rather than
     * bringing it back at the next chance.
     */
    AsyncFunction("render") { state: WorkoutLiveState ->
      render(state)
    }

    /** Ends the session: the service stands down and the notification goes. */
    AsyncFunction("stop") {
      val running = WorkoutLiveService.instance

      if (running != null) running.finish()
      else WorkoutLiveNotification.cancel(context)

      // A press that was never drained belongs to a workout that no longer
      // exists. Leaving it queued would apply it to the next session.
      PendingActions.clear(context)
    }

    /** Removes and returns every button press since the last call. */
    AsyncFunction("drainActions") {
      PendingActions.drain(context)
    }
  }

  private fun render(state: WorkoutLiveState) {
    val running = WorkoutLiveService.instance

    if (running != null) {
      running.render(state)
      return
    }

    // Asked before starting rather than discovered inside the service, because
    // `startForegroundService` opens a five-second window in which the service
    // *must* reach `startForeground` or the system kills the app. Walking into
    // that window already knowing the call will be refused is the one way to
    // turn a missing permission into a crash.
    if (hasPermission(Manifest.permission.ACTIVITY_RECOGNITION, sinceApi = 34)) {
      try {
        WorkoutLiveService.start(context, state)
        return
      } catch (_: Exception) {
        // The platform refuses `startForegroundService` from the background.
        // Fall through: the next push made while the app is foregrounded gets
        // another chance at promoting this to a service.
      }
    }

    WorkoutLiveNotification.notify(
      context,
      WorkoutLiveNotification.build(context, state, System.currentTimeMillis()),
    )
  }

  /** True where the permission is granted, or where this Android version predates it. */
  private fun hasPermission(permission: String, sinceApi: Int): Boolean {
    if (Build.VERSION.SDK_INT < sinceApi) return true
    return appContext.permissions?.hasGrantedPermissions(permission) ?: false
  }
}
