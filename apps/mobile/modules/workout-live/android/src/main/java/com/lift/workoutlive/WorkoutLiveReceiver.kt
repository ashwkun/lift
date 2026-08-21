package com.lift.workoutlive

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Where a notification button lands.
 *
 * It does exactly two things, in this order: write the press to the durable
 * queue, then ring the doorbell. It deliberately does *not* carry the press to
 * JavaScript itself, and it deliberately does not touch the workout.
 *
 * The reason is that a receiver can run in a process with no JavaScript in it —
 * Android starts the process to deliver the broadcast, and that is all. If the
 * press were delivered as an event payload it would be dropped on the floor
 * there. Because it is queued first and read second, the app applies it the next
 * time it is looking, and "the next time it is looking" is usually the same
 * millisecond, because the foreground service kept the runtime alive.
 *
 * Not touching the workout is the other half. A set is completed by
 * `handleToggleSet` on the active screen, which commits the ghosted numbers the
 * user was looking at, asks `canLogSet` whether the tap is allowed at all and
 * scales the rest that follows to the kind of set it was. Re-deriving any of
 * that from a `BroadcastReceiver`, against a database this module cannot see,
 * would be a second implementation of the subtlest logic in the app.
 */
class WorkoutLiveReceiver : BroadcastReceiver() {

  companion object {
    const val ACTION = "com.lift.workoutlive.ACTION"
    const val EXTRA_TYPE = "type"
    const val EXTRA_SECONDS = "seconds"
  }

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION) return

    val type = intent.getStringExtra(EXTRA_TYPE) ?: return
    val seconds = intent.getIntExtra(EXTRA_SECONDS, 0)

    PendingActions.enqueue(context, type, seconds)
    WorkoutLiveModule.announcePendingActions()
  }
}
