package com.lift.workoutlive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Draws the shade.
 *
 * The one idea worth holding on to: **this file never renders a duration it has
 * computed itself as the source of truth.** `setWhen` takes the absolute epoch
 * the rest period ends at, `setUsesChronometer` tells Android to render the
 * difference, and SystemUI ticks it once a second in its own process. So the
 * countdown stays correct even if this app is killed, is never a second behind,
 * and costs nothing to keep running.
 *
 * The text readout drawn alongside it *is* recomputed, once a second, by
 * `WorkoutLiveService` — but only because that gives a large, legible number
 * where the chronometer is a small header element. If those updates ever stop,
 * the chronometer is still right. One of the two is a nicety; the other is the
 * guarantee.
 */
internal object WorkoutLiveNotification {

  /**
   * Replaces `workout-ongoing`, which `features/notifications/workout.ts` used.
   *
   * A new id rather than a reconfiguration of the old one, for the reason
   * spelled out in `features/notifications/rest.ts`: a channel's settings are
   * fixed at creation, and updating an existing one is silently ignored. The old
   * channel is deleted so the settings screen does not list two.
   */
  const val CHANNEL_ID = "workout-live"
  private const val LEGACY_CHANNEL_ID = "workout-ongoing"

  /** Stable, so every post updates the one notification instead of stacking. */
  const val NOTIFICATION_ID = 0x4C49

  /**
   * Matches `expo.scheme` in `app.json`, and the route the session lives at.
   *
   * A deep link rather than a bare launch intent: `MainActivity` is
   * `launchMode="singleTask"`, so this routes into the running task and
   * expo-router navigates, instead of merely foregrounding whichever screen the
   * user happened to leave open.
   */
  private const val DEEP_LINK = "lift://workout/active"

  // Distinct per action. PendingIntents that match on component and request code
  // are the *same* PendingIntent, so sharing one would make every button do
  // whatever the last-built one does.
  private const val REQUEST_CONTENT = 100
  private const val REQUEST_COMPLETE = 101
  private const val REQUEST_ADJUST = 102
  private const val REQUEST_PAUSE = 103
  private const val REQUEST_SKIP = 104

  fun ensureChannel(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return

    val channel = NotificationChannel(
      CHANNEL_ID,
      "Workout in progress",
      // LOW: present in the shade, never a sound, a vibration or a heads-up
      // banner. The rest bell is a separate notification on a separate HIGH
      // channel (`features/notifications/rest.ts`) and stays that way — this one
      // re-posts once a second while resting, and any importance above LOW would
      // make that intolerable.
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Shows your open workout and rest timer while a session is running."
      setShowBadge(false)
      setSound(null, null)
      enableVibration(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }

    manager.createNotificationChannel(channel)
    runCatching { manager.deleteNotificationChannel(LEGACY_CHANNEL_ID) }
  }

  fun build(context: Context, state: WorkoutLiveState, nowMs: Long): Notification {
    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.workout_live_icon)
      .setColor(parseColor(state.accentColor))
      .setContentIntent(contentIntent(context))
      .setOngoing(true)
      .setSilent(true)
      .setShowWhen(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_WORKOUT)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      // Without this Android holds a foreground-service notification back for
      // ten seconds. Ten seconds is most of a warm-up rest.
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)

    when {
      state.isPaused -> {
        val remaining = state.remainingSeconds(nowMs)
        builder
          .setContentTitle("Rest paused · ${formatDuration(remaining)}")
          .setContentText(state.restLabel ?: state.title)
          .setSubText(state.title)
          // No chronometer: there is no deadline to count towards while paused,
          // and a frozen clock is exactly what "paused" should look like.
          .setUsesChronometer(false)
          .setShowWhen(false)
          .setProgress(progressMax(state), progressMax(state) - remaining, false)
          .addAction(adjustAction(context, state))
          .addAction(pauseAction(context, resume = true))
          .addAction(skipAction(context))
      }

      state.isCountingDown(nowMs) -> {
        val remaining = state.remainingSeconds(nowMs)
        builder
          .setContentTitle("Rest · ${formatDuration(remaining)}")
          .setContentText(state.restLabel ?: state.title)
          .setSubText(state.title)
          .setWhen(state.restEndsAtMs!!.toLong())
          .setUsesChronometer(true)
          .setChronometerCountDown(true)
          .setProgress(progressMax(state), progressMax(state) - remaining, false)
          .addAction(adjustAction(context, state))
          .addAction(pauseAction(context, resume = false))
          .addAction(skipAction(context))
      }

      state.isRestFinished(nowMs) -> {
        builder
          .setContentTitle("Rest complete")
          .setContentText(state.restLabel ?: state.line)
          .setSubText(state.title)
          // Counting on past zero would turn the header into a stopwatch of how
          // late the user is, which is a nag rather than information.
          .setUsesChronometer(false)
          .setShowWhen(false)
          .setProgress(progressMax(state), progressMax(state), false)
          // Completing first, because it is what happens next. Rest being over
          // is the cue to do the set, and the shade is where the user confirms
          // they did — dismissing is only tidying up after deciding not to.
          .also { if (state.canCompleteSet) it.addAction(completeAction(context)) }
          .addAction(skipAction(context, label = "Dismiss"))
      }

      else -> {
        builder
          .setContentTitle(state.title)
          .setContentText(state.line)
          // Count *up* from the start of the workout. Same mechanism, opposite
          // direction, and the same guarantee: it stays right unattended.
          .setWhen(state.startedAtMs.toLong())
          .setUsesChronometer(true)
          .setChronometerCountDown(false)
          .also { if (state.canCompleteSet) it.addAction(completeAction(context)) }
      }
    }

    return builder.build()
  }

  /**
   * Posts without going through the service.
   *
   * Used for every update once the service is already in the foreground, and as
   * the whole of the fallback path when it could not get there. Wrapped because
   * `notify` throws where POST_NOTIFICATIONS was refused, and a refused
   * notification is not something a workout should fail on.
   */
  fun notify(context: Context, notification: Notification) {
    runCatching { NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification) }
  }

  fun cancel(context: Context) {
    runCatching { NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID) }
  }

  // -------------------------------------------------------------------------
  // Intents
  // -------------------------------------------------------------------------

  private fun contentIntent(context: Context): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(DEEP_LINK)).apply {
      // Scoped to us, so this can never resolve to a browser or a chooser.
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    return PendingIntent.getActivity(context, REQUEST_CONTENT, intent, flags())
  }

  private fun adjustAction(context: Context, state: WorkoutLiveState): NotificationCompat.Action =
    action(
      context,
      REQUEST_ADJUST,
      PendingActions.ADJUST_REST,
      "+${state.adjustSeconds}s",
      state.adjustSeconds,
    )

  private fun pauseAction(context: Context, resume: Boolean): NotificationCompat.Action =
    action(
      context,
      REQUEST_PAUSE,
      PendingActions.TOGGLE_PAUSE,
      if (resume) "Resume" else "Pause",
    )

  private fun skipAction(context: Context, label: String = "Skip"): NotificationCompat.Action =
    action(context, REQUEST_SKIP, PendingActions.SKIP_REST, label)

  private fun completeAction(context: Context): NotificationCompat.Action =
    action(context, REQUEST_COMPLETE, PendingActions.COMPLETE_SET, "Complete set")

  private fun action(
    context: Context,
    requestCode: Int,
    type: String,
    label: String,
    seconds: Int = 0,
  ): NotificationCompat.Action {
    val intent = Intent(context, WorkoutLiveReceiver::class.java).apply {
      action = WorkoutLiveReceiver.ACTION
      putExtra(WorkoutLiveReceiver.EXTRA_TYPE, type)
      putExtra(WorkoutLiveReceiver.EXTRA_SECONDS, seconds)
    }

    val pending = PendingIntent.getBroadcast(context, requestCode, intent, flags())

    // Iconless on purpose. Since Android 7 the framework's own templates drop
    // action icons on phones and draw the label alone; supplying one would only
    // change how this looks on Wear, which is not a surface this is designed for.
    return NotificationCompat.Action.Builder(0, label, pending).build()
  }

  /**
   * `UPDATE_CURRENT` so a rebuilt notification's buttons carry the newest extras
   * — the adjust button's amount rides in them — rather than reusing the ones
   * captured the first time the workout started.
   */
  private fun flags(): Int =
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT

  // -------------------------------------------------------------------------
  // Rendering helpers
  // -------------------------------------------------------------------------

  /** At least 1: a zero-length bar is a divide-by-zero in the platform's renderer. */
  private fun progressMax(state: WorkoutLiveState): Int = maxOf(1, state.restTotalSeconds)

  /** `m:ss`, or `h:mm:ss` past an hour. Mirrors `formatDuration` in `@lift/shared`. */
  private fun formatDuration(totalSeconds: Int): String {
    val safe = maxOf(0, totalSeconds)
    val hours = safe / 3600
    val minutes = (safe % 3600) / 60
    val seconds = safe % 60

    return if (hours > 0) {
      String.format(java.util.Locale.US, "%d:%02d:%02d", hours, minutes, seconds)
    } else {
      String.format(java.util.Locale.US, "%d:%02d", minutes, seconds)
    }
  }

  /** A malformed colour falls back to the platform default rather than throwing. */
  private fun parseColor(value: String): Int = try {
    Color.parseColor(value)
  } catch (_: IllegalArgumentException) {
    Notification.COLOR_DEFAULT
  }
}
