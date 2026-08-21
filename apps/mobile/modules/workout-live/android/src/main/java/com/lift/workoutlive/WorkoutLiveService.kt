package com.lift.workoutlive

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Keeps the process alive for the length of a session, and owns the one-second
 * repaint while resting.
 *
 * ## What the service is actually for
 *
 * Not the clock — `WorkoutLiveNotification` hands Android an absolute deadline
 * and SystemUI ticks it, with or without us. What running in the foreground buys
 * is that the JavaScript runtime stays alive: a notification button reaches a
 * live store in milliseconds instead of waking a dead process, and the exercise
 * name and set tally in the shade stay current instead of freezing at whatever
 * they last read.
 *
 * ## The one-second repaint
 *
 * Bounded to a rest period, which is a couple of minutes at most, and it exists
 * only to draw a large readout and move the progress bar — the header
 * chronometer is already correct without it. Nothing on the JavaScript side
 * participates: no bridge crossing, no re-render, no work on the thread that is
 * handling the weight field the user is typing into between sets.
 */
class WorkoutLiveService : Service() {

  companion object {
    /**
     * The running service, for the module to push updates into directly.
     *
     * The alternative is an `Intent` per update through `startService`, which
     * marshals the state, hops through ActivityManager and is subject to
     * background-start rules that a running foreground service only mostly
     * exempts us from. A field is both cheaper and fewer ways to fail.
     */
    @Volatile
    var instance: WorkoutLiveService? = null
      private set

    const val EXTRA_STATE = "com.lift.workoutlive.STATE"

    fun start(context: Context, state: WorkoutLiveState) {
      val intent = Intent(context, WorkoutLiveService::class.java)
        .putExtra(EXTRA_STATE, state.toBundle())

      ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, WorkoutLiveService::class.java))
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private var state: WorkoutLiveState? = null

  /**
   * False once `startForeground` has been refused.
   *
   * From Android 14 the `health` service type additionally requires
   * ACTIVITY_RECOGNITION to have been granted, and throws SecurityException when
   * it has not. Rather than lose the notification entirely, the session carries
   * on as an ordinary ongoing notification: the countdown, the progress bar and
   * the buttons all still work, because none of them were the service's doing.
   * What is given up is the protection against being killed in the background.
   */
  private var foreground = false

  private val ticker = object : Runnable {
    override fun run() {
      val current = state ?: return
      paint(current)

      // Re-read the clock rather than trusting the state: the deadline may have
      // passed during this very pass, and the next frame is the "Rest complete"
      // one, which is the last one worth drawing.
      if (current.isCountingDown(System.currentTimeMillis())) {
        handler.postDelayed(this, 1_000L)
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    instance = this
    WorkoutLiveNotification.ensureChannel(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val bundle = intent?.getBundleExtra(EXTRA_STATE)

    // A restart with no payload has nothing to draw, but the contract for
    // `startForegroundService` still demands a `startForeground` within five
    // seconds or the process is killed. Standing down immediately is the only
    // honest way to satisfy both.
    if (bundle == null && state == null) {
      stopSelf()
      return START_NOT_STICKY
    }

    if (bundle != null) render(WorkoutLiveState.fromBundle(bundle))

    // Never sticky. A workout that ended while the process was gone must not be
    // resurrected by the system as an empty notification the user cannot clear.
    return START_NOT_STICKY
  }

  /** Replaces the rendered state and restarts the repaint loop under it. */
  fun render(next: WorkoutLiveState) {
    state = next
    handler.removeCallbacks(ticker)

    paint(next)

    if (next.isCountingDown(System.currentTimeMillis())) {
      handler.postDelayed(ticker, 1_000L)
    }
  }

  fun finish() {
    handler.removeCallbacks(ticker)
    state = null

    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    WorkoutLiveNotification.cancel(this)
    stopSelf()
  }

  private fun paint(current: WorkoutLiveState) {
    val notification = WorkoutLiveNotification.build(this, current, System.currentTimeMillis())

    if (foreground) {
      WorkoutLiveNotification.notify(this, notification)
      return
    }

    try {
      ServiceCompat.startForeground(
        this,
        WorkoutLiveNotification.NOTIFICATION_ID,
        notification,
        serviceType(),
      )
      foreground = true
    } catch (_: Exception) {
      // The module checks the permission before ever starting us, so this is
      // the backstop rather than the expected path — a revocation that landed
      // between the check and here, say.
      //
      // Standing down is not optional. `startForegroundService` gives a service
      // five seconds to reach `startForeground`, and a process that neither
      // reaches it nor stops is killed. The notification is unaffected either
      // way: it was posted by the notification manager, not by us, and it stays
      // in the shade after we are gone.
      WorkoutLiveNotification.notify(this, notification)
      stopSelf()
    }
  }

  /**
   * `health` is the type Android names for workout tracking, and the only one
   * whose description matches what this does. Below Android 14 the platform
   * takes no type argument worth giving — zero means "whatever the manifest
   * declared", which is the same answer.
   */
  private fun serviceType(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH
    } else {
      0
    }

  override fun onDestroy() {
    handler.removeCallbacks(ticker)
    instance = null
    super.onDestroy()
  }

  /** Nothing binds to this; it is started and stopped, never connected to. */
  override fun onBind(intent: Intent?): IBinder? = null
}
