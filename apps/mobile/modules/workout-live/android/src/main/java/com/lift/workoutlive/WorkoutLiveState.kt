package com.lift.workoutlive

import android.os.Bundle
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * Everything the shade needs to draw itself, as pushed from JavaScript.
 *
 * Deliberately a *description*, not a mirror of the store. Nothing here is a
 * countdown, a tick or a duration that has to be kept up to date: the rest
 * period is an absolute epoch, exactly as `store/timer.ts` holds it, and the
 * elapsed clock is the epoch the workout started at. Both are handed straight to
 * `setWhen()`, and the system renders the moving part.
 *
 * That is the whole reason this class has no timer in it. A native clock ticking
 * alongside the JS one is two clocks, and two clocks disagree — which is the
 * failure `features/workouts/rest-controls.ts` exists to prevent. Here there is
 * one deadline, held in one place, rendered by a third party.
 */
class WorkoutLiveState(
  /** Workout name. The header line, and the title while no rest is running. */
  @Field val title: String = "",

  /** Current exercise and set tally — "Bench Press · 12 sets". */
  @Field val line: String = "",

  /** Epoch ms the workout began. Drives the count-*up* chronometer. */
  @Field val startedAtMs: Double = 0.0,

  /** Epoch ms rest ends, or null when idle or paused. Drives the count-*down*. */
  @Field val restEndsAtMs: Double? = null,

  /** Seconds frozen on a paused rest period; null whenever it is running. */
  @Field val restPausedSeconds: Int? = null,

  /** The span the countdown covers, for the progress bar. */
  @Field val restTotalSeconds: Int = 0,

  /** What the rest belongs to — "Bench Press", or "Warm-up rest". */
  @Field val restLabel: String? = null,

  /**
   * What one press of the adjust button is worth.
   *
   * Passed in rather than hardcoded so the button can be *labelled* with it, and
   * so it stays equal to `ADJUST_SECONDS` in `rest-controls.ts` — a shade
   * offering "+30s" for a control the app calls "+15s" is two answers to one
   * question.
   */
  @Field val adjustSeconds: Int = 15,

  /** Whether an unchecked set exists to tick. Hides the action when it does not. */
  @Field val canCompleteSet: Boolean = false,

  /** `#RRGGBB`, tinting the icon and the app name in the header. */
  @Field val accentColor: String = "#D2F34B",
) : Record {

  /** True while a rest period is counting down and has not yet reached zero. */
  fun isCountingDown(nowMs: Long): Boolean {
    val ends = restEndsAtMs ?: return false
    return restPausedSeconds == null && ends > nowMs
  }

  /** True once a running rest period has passed its deadline. */
  fun isRestFinished(nowMs: Long): Boolean {
    val ends = restEndsAtMs ?: return false
    return restPausedSeconds == null && ends <= nowMs
  }

  val isPaused: Boolean get() = restPausedSeconds != null

  /** Whole seconds still to run, from either the deadline or the frozen value. */
  fun remainingSeconds(nowMs: Long): Int {
    restPausedSeconds?.let { return it }
    val ends = restEndsAtMs ?: return 0
    return Math.max(0, Math.ceil((ends - nowMs) / 1000.0).toInt())
  }

  /**
   * Marshalled for the one hop that cannot pass an object: the `Intent` that
   * starts the service. Every later update reaches the running service directly,
   * so this runs once per workout rather than once per change.
   */
  fun toBundle(): Bundle = Bundle().apply {
    putString(KEY_TITLE, title)
    putString(KEY_LINE, line)
    putDouble(KEY_STARTED_AT, startedAtMs)
    restEndsAtMs?.let { putDouble(KEY_REST_ENDS_AT, it) }
    restPausedSeconds?.let { putInt(KEY_REST_PAUSED, it) }
    putInt(KEY_REST_TOTAL, restTotalSeconds)
    putString(KEY_REST_LABEL, restLabel)
    putInt(KEY_ADJUST, adjustSeconds)
    putBoolean(KEY_CAN_COMPLETE, canCompleteSet)
    putString(KEY_ACCENT, accentColor)
  }

  companion object {
    private const val KEY_TITLE = "title"
    private const val KEY_LINE = "line"
    private const val KEY_STARTED_AT = "startedAtMs"
    private const val KEY_REST_ENDS_AT = "restEndsAtMs"
    private const val KEY_REST_PAUSED = "restPausedSeconds"
    private const val KEY_REST_TOTAL = "restTotalSeconds"
    private const val KEY_REST_LABEL = "restLabel"
    private const val KEY_ADJUST = "adjustSeconds"
    private const val KEY_CAN_COMPLETE = "canCompleteSet"
    private const val KEY_ACCENT = "accentColor"

    fun fromBundle(bundle: Bundle): WorkoutLiveState = WorkoutLiveState(
      title = bundle.getString(KEY_TITLE).orEmpty(),
      line = bundle.getString(KEY_LINE).orEmpty(),
      startedAtMs = bundle.getDouble(KEY_STARTED_AT),
      // `containsKey` rather than a sentinel: zero is a legal epoch and a legal
      // pause, and "absent" has to stay distinguishable from either.
      restEndsAtMs = if (bundle.containsKey(KEY_REST_ENDS_AT)) bundle.getDouble(KEY_REST_ENDS_AT) else null,
      restPausedSeconds = if (bundle.containsKey(KEY_REST_PAUSED)) bundle.getInt(KEY_REST_PAUSED) else null,
      restTotalSeconds = bundle.getInt(KEY_REST_TOTAL),
      restLabel = bundle.getString(KEY_REST_LABEL),
      adjustSeconds = bundle.getInt(KEY_ADJUST, 15),
      canCompleteSet = bundle.getBoolean(KEY_CAN_COMPLETE),
      accentColor = bundle.getString(KEY_ACCENT) ?: "#D2F34B",
    )
  }
}
