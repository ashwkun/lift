package com.lift.workoutlive

import android.content.Context
import android.os.Bundle
import org.json.JSONArray
import org.json.JSONObject

/**
 * The durable queue a notification button writes into.
 *
 * Every button press lands here first and is *only* then announced to
 * JavaScript, which drains it. One channel rather than two means a press can
 * never be applied twice — the alternative, carrying the payload on the event
 * and also queueing it, has to reconcile the two whenever both arrive.
 *
 * It has to be durable because a `BroadcastReceiver` can run in a process with
 * no JavaScript in it. The foreground service normally keeps the runtime alive,
 * so that is the rare case, not the usual one; but "rare" here means a tap that
 * silently does nothing, and the fix is a `SharedPreferences` write.
 *
 * Disk, not memory, for the same reason: the process the receiver woke may be
 * torn down again before the app is ever opened.
 */
internal object PendingActions {
  private const val PREFS = "com.lift.workoutlive.pending"
  private const val KEY = "actions"

  /**
   * Beyond this the queue is discarding, not accumulating.
   *
   * A user tapping "complete set" sixteen times without the app ever draining is
   * not sixteen sets they mean to log; it is a notification that has stopped
   * responding. Dropping the oldest keeps the most recent intent, which is the
   * one they are still looking at.
   */
  private const val LIMIT = 16

  const val COMPLETE_SET = "complete-set"
  const val ADJUST_REST = "adjust-rest"
  const val TOGGLE_PAUSE = "toggle-pause"
  const val SKIP_REST = "skip-rest"

  private val lock = Any()

  fun enqueue(context: Context, type: String, seconds: Int) {
    synchronized(lock) {
      val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val queue = read(prefs.getString(KEY, null))

      queue.put(JSONObject().put("type", type).put("seconds", seconds))
      while (queue.length() > LIMIT) queue.remove(0)

      // `commit`, not `apply`: a receiver's process can be killed the moment
      // `onReceive` returns, and `apply` is allowed to still be writing then.
      prefs.edit().putString(KEY, queue.toString()).commit()
    }
  }

  /**
   * Removes and returns everything queued.
   *
   * Atomic under the same lock as `enqueue`, so a press arriving mid-drain is
   * either fully in this batch or fully in the next one — never lost between
   * the read and the clear.
   */
  fun drain(context: Context): List<Bundle> {
    synchronized(lock) {
      val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val raw = prefs.getString(KEY, null) ?: return emptyList()
      prefs.edit().remove(KEY).commit()

      val queue = read(raw)
      val out = ArrayList<Bundle>(queue.length())

      for (index in 0 until queue.length()) {
        val entry = queue.optJSONObject(index) ?: continue
        val type = entry.optString("type").takeIf { it.isNotEmpty() } ?: continue
        out.add(
          Bundle().apply {
            putString("type", type)
            putInt("seconds", entry.optInt("seconds", 0))
          },
        )
      }

      return out
    }
  }

  fun clear(context: Context) {
    synchronized(lock) {
      context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .remove(KEY)
        .commit()
    }
  }

  /** A corrupt or half-written value starts an empty queue rather than throwing. */
  private fun read(raw: String?): JSONArray = try {
    if (raw == null) JSONArray() else JSONArray(raw)
  } catch (_: Exception) {
    JSONArray()
  }
}
