package com.lift.homewidgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews

/**
 * The routines tile: the list you already keep, one tap from lifting.
 *
 * Three things it does that are worth knowing about before reading the code.
 *
 * **A tap starts the session.** Not "opens the routine" — the link carries a
 * `?start=` token and the routine screen runs the same `startSession` every
 * other Start in the app runs, so the one-session rule, the resume case and the
 * "a workout is in progress" dialog all behave identically to tapping Start
 * inside the app. Nothing about the decision is re-made here, and nothing here
 * knows what any of those links say.
 *
 * **The header is the open session when there is one.** It shows the name and a
 * `Chronometer`, and it links to `/workout/active`. The clock is given the epoch
 * the workout started at and ticked by the launcher, so it is right whether or
 * not this app is running — the same arrangement, for the same reason, as the
 * ongoing notification's count-up.
 *
 * **The row count follows the widget's height.** See `slots`.
 */
class RoutinesWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    val snapshot = WidgetSnapshot.load(context)
    for (id in appWidgetIds) {
      manager.updateAppWidget(id, build(context, snapshot, slots(manager, id)))
    }
  }

  /**
   * Redraws one widget after it is resized on the home screen.
   *
   * Without this a widget dragged from two cells to four keeps the row count it
   * was built with and leaves the new space empty until something else happens
   * to publish a snapshot.
   */
  override fun onAppWidgetOptionsChanged(
    context: Context,
    manager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: Bundle,
  ) {
    manager.updateAppWidget(
      appWidgetId,
      build(context, WidgetSnapshot.load(context), slots(manager, appWidgetId)),
    )
  }

  companion object {
    private const val REQUEST_HEADER = 400
    private const val REQUEST_START_EMPTY = 401

    /**
     * Where the per-routine request codes start.
     *
     * Spaced above everything else in this module so the block can grow with
     * `MAX_SLOTS` without ever reaching another target's code.
     */
    private const val REQUEST_ROUTINE = 500

    /** Matches `widget_routines_row.xml`: a 44dp row and the 4dp gap below it. */
    private const val ROW_DP = 48

    /** `widget_routines.xml`'s vertical padding, and its header. */
    private const val PADDING_DP = 20
    private const val HEADER_DP = 30

    /**
     * The count used when the launcher will not say how tall the widget is,
     * which is what `getAppWidgetOptions` returns for a host that never
     * populated them. Deliberately small: too few rows looks deliberate, too
     * many are clipped.
     */
    private const val DEFAULT_SLOTS = 3

    /**
     * The ceiling, and therefore how many rows the publisher needs to send —
     * `MAX_WIDGET_ROWS` in `features/home-widgets/publisher.tsx` is this number.
     * A widget taller than this is rare enough not to be worth the rows sitting
     * unused in every snapshot.
     */
    const val MAX_SLOTS = 8

    fun render(context: Context, manager: AppWidgetManager, snapshot: WidgetSnapshot) {
      val ids = manager.getAppWidgetIds(ComponentName(context, RoutinesWidgetProvider::class.java))
      if (ids.isEmpty()) return

      // Per id rather than one `RemoteViews` for all of them: two placements of
      // this widget can be different heights, and the row count is derived from
      // the height.
      for (id in ids) manager.updateAppWidget(id, build(context, snapshot, slots(manager, id)))
    }

    /**
     * How many rows fit.
     *
     * `OPTION_APPWIDGET_MAX_HEIGHT` is the *portrait* bound; `MIN_HEIGHT` is the
     * landscape one. Reading the smaller of the two would guarantee nothing is
     * ever clipped on a launcher that rotates, at the cost of showing a phone
     * held upright — which is every use of this widget — roughly half the rows
     * it has room for. This takes the portrait figure and accepts that a rotated
     * home screen crops the last row.
     */
    private fun slots(manager: AppWidgetManager, appWidgetId: Int): Int {
      val height = runCatching {
        manager.getAppWidgetOptions(appWidgetId).getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0)
      }.getOrDefault(0)

      if (height <= 0) return DEFAULT_SLOTS

      return ((height - PADDING_DP - HEADER_DP) / ROW_DP).coerceIn(1, MAX_SLOTS)
    }

    private fun build(context: Context, snapshot: WidgetSnapshot, slots: Int): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.widget_routines)
      val palette = WidgetPalette.from(snapshot)

      WidgetSurface.tint(views, R.id.routines_backdrop, palette.surface)
      WidgetSurface.tint(views, R.id.routines_mark, palette.accent)

      header(context, views, snapshot, palette)
      rows(context, views, snapshot, palette, slots)

      return views
    }

    /** The brand line, or the open session with a clock the launcher ticks. */
    private fun header(
      context: Context,
      views: RemoteViews,
      snapshot: WidgetSnapshot,
      palette: WidgetPalette,
    ) {
      val active = snapshot.activeTitle
      val startedAt = snapshot.activeStartedAtMs

      views.setTextColor(R.id.routines_title, if (active != null) palette.text else palette.muted)
      views.setTextColor(R.id.routines_clock, palette.accent)
      views.setTextViewText(
        R.id.routines_title,
        active ?: context.getString(R.string.widget_brand),
      )

      if (active != null && startedAt != null) {
        views.setViewVisibility(R.id.routines_clock, View.VISIBLE)
        // `Chronometer.base` is measured against `elapsedRealtime`, not the wall
        // clock, so the epoch has to be rebased into it. Both are read here, in
        // the same breath, which is the only moment the two are known to agree.
        views.setChronometer(
          R.id.routines_clock,
          SystemClock.elapsedRealtime() - (System.currentTimeMillis() - startedAt.toLong()),
          null,
          true,
        )
      } else {
        views.setViewVisibility(R.id.routines_clock, View.GONE)
        // Stopped as well as hidden: a `Chronometer` left running in a widget
        // keeps the launcher redrawing it once a second for nothing.
        views.setChronometer(R.id.routines_clock, SystemClock.elapsedRealtime(), null, false)
      }

      views.setContentDescription(
        R.id.routines_header,
        active?.let { context.getString(R.string.widget_resume_label, it) }
          ?: context.getString(R.string.widget_brand),
      )

      views.setOnClickPendingIntent(
        R.id.routines_header,
        WidgetSurface.open(context, snapshot.headerLink, REQUEST_HEADER),
      )
    }

    /**
     * The routines, then the ad-hoc start.
     *
     * `removeAllViews` first, because `RemoteViews` are cumulative: this method
     * runs on every publish and every resize, and without it a five-routine
     * widget appends five more rows each time. It is also what clears the sample
     * rows `widget_routines.xml` carries for the widget picker's benefit.
     *
     * The ad-hoc start is the last row rather than the first, and it is the row
     * that gets dropped when there is only one slot. At that size the one thing
     * worth showing is the routine at the top of the list, and an empty session
     * is always still one tap away through the header.
     *
     * There is no empty-state branch. When there are no routines the publisher
     * sends a single row that says so and links to the routines list, which is a
     * row like any other.
     */
    private fun rows(
      context: Context,
      views: RemoteViews,
      snapshot: WidgetSnapshot,
      palette: WidgetPalette,
      slots: Int,
    ) {
      views.removeAllViews(R.id.routines_rows)

      // One slot goes to the ad-hoc start, unless that would leave no routines
      // at all. `take` is safe past the end of the list.
      val forRoutines = if (slots > 1) slots - 1 else slots

      for ((index, entry) in snapshot.rows.take(forRoutines).withIndex()) {
        views.addView(
          R.id.routines_rows,
          row(
            context,
            palette,
            name = entry.name,
            meta = entry.meta,
            link = entry.link,
            requestCode = REQUEST_ROUTINE + index,
            accented = false,
          ),
        )
      }

      if (slots > 1) {
        views.addView(
          R.id.routines_rows,
          row(
            context,
            palette,
            name = snapshot.startLabel,
            meta = "",
            link = snapshot.startLink,
            requestCode = REQUEST_START_EMPTY,
            accented = true,
          ),
        )
      }
    }

    /** One row, painted and wired. `accented` marks the ad-hoc start. */
    private fun row(
      context: Context,
      palette: WidgetPalette,
      name: String,
      meta: String,
      link: String,
      requestCode: Int,
      accented: Boolean,
    ): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.widget_routines_row)

      WidgetSurface.tint(views, R.id.row_backdrop, palette.row)
      views.setTextViewText(R.id.row_name, name)
      views.setTextColor(R.id.row_name, if (accented) palette.accent else palette.text)

      views.setTextViewText(R.id.row_meta, meta)
      views.setTextColor(R.id.row_meta, palette.muted)
      views.setViewVisibility(R.id.row_meta, if (meta.isEmpty()) View.GONE else View.VISIBLE)

      // Announced as one phrase. TalkBack would otherwise read the row's two
      // children as two separate items, which turns "Push Day, 2 days ago" into
      // two swipes for one tap target.
      views.setContentDescription(R.id.row_root, if (meta.isEmpty()) name else "$name, $meta")
      views.setOnClickPendingIntent(R.id.row_root, WidgetSurface.open(context, link, requestCode))

      return views
    }
  }
}
