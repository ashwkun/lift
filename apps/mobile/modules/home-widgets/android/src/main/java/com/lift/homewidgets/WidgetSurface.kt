package com.lift.homewidgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.widget.RemoteViews

/**
 * The two things both widgets need: paint, and somewhere to land.
 *
 * ## Painting a themed surface through RemoteViews
 *
 * A widget is inflated in the launcher's process, so nothing here can hold a
 * `View` or call a method on one. `RemoteViews` allows a fixed set of remotable
 * calls, and `setBackgroundColor` is one of them — but a flat colour is all it
 * can set, which throws away the rounded corners the platform expects a widget
 * to have.
 *
 * So every themed surface in these layouts is an `ImageView` sitting behind the
 * content with a rounded rectangle as its drawable, and the theme's colour
 * arrives as a colour *filter* on that image. `ImageView.setColorFilter(int)`
 * applies it `SRC_ATOP`, which replaces the shape's own colour wherever the
 * shape is opaque and leaves the corners alone. `setBackgroundTintList` would
 * say the same thing in one call, and is API 31.
 */
internal object WidgetSurface {

  /**
   * A tap target.
   *
   * The link always comes from the snapshot: see `WidgetRow`. Deep links rather
   * than bare launch intents, and `MainActivity` is `launchMode="singleTask"`,
   * so a tap routes into the running task and expo-router navigates instead of
   * merely foregrounding whichever screen was left open.
   * `WorkoutLiveNotification.kt` relies on the same property.
   *
   * `requestCode` is distinct per target for the reason
   * `WorkoutLiveNotification.kt` gives: PendingIntents matching on component and
   * request code are the *same* PendingIntent, so a shared one would make every
   * row do whatever the last-built one does. The links differ too, which alone
   * would be enough, but the routine rows are built in a loop and their codes
   * are the only thing that stays readable when the list is reordered.
   */
  fun open(context: Context, link: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(link)).apply {
      // Scoped to us, so this can never resolve to a browser or a chooser.
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    return PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      // UPDATE_CURRENT so a rebuilt row carries the newest link rather than the
      // one captured when that slot was first filled by a different routine.
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  /** A malformed colour falls back rather than throwing on the launcher's thread. */
  fun color(value: String, fallback: Int): Int = try {
    Color.parseColor(value)
  } catch (_: IllegalArgumentException) {
    fallback
  }

  /** Recolours one of the rounded backdrops described above. */
  fun tint(views: RemoteViews, viewId: Int, color: Int) {
    views.setInt(viewId, "setColorFilter", color)
  }

  /**
   * Redraws every placed widget of both kinds.
   *
   * Silent when none are placed: `getAppWidgetIds` answers with an empty array
   * and each provider returns without touching the manager. That is the common
   * case — most people never add a widget — and it costs one binder call.
   */
  fun refresh(context: Context) {
    val manager = AppWidgetManager.getInstance(context) ?: return
    val snapshot = WidgetSnapshot.load(context)

    // Independently guarded: a launcher that has thrown once should not be able
    // to stop the other widget from ever updating again.
    runCatching { WeightWidgetProvider.render(context, manager, snapshot) }
    runCatching { RoutinesWidgetProvider.render(context, manager, snapshot) }
  }
}

/**
 * The five colours, resolved once per draw.
 *
 * Every field has a literal behind it rather than a call back into the snapshot
 * defaults, because a fallback that is itself parsed from a string is a fallback
 * with a failure mode. These are `darkPalette` in `theme/tokens.ts`, and are the
 * one place in this module where a palette value is written twice — the note on
 * `theme/launcher-icons.ts` describes the same trade and the same drift risk.
 */
internal class WidgetPalette(
  val surface: Int,
  val row: Int,
  val text: Int,
  val muted: Int,
  val accent: Int,
) {
  companion object {
    private const val DEFAULT_SURFACE = 0xFF1A1A1A.toInt()
    private const val DEFAULT_ROW = 0xFF2A2A2A.toInt()
    private const val DEFAULT_TEXT = 0xFFF5F7F8.toInt()
    private const val DEFAULT_MUTED = 0xFFB8BEC5.toInt()
    private const val DEFAULT_ACCENT = 0xFFD2F34B.toInt()

    fun from(snapshot: WidgetSnapshot): WidgetPalette = WidgetPalette(
      surface = WidgetSurface.color(snapshot.surfaceColor, DEFAULT_SURFACE),
      row = WidgetSurface.color(snapshot.rowColor, DEFAULT_ROW),
      text = WidgetSurface.color(snapshot.textColor, DEFAULT_TEXT),
      muted = WidgetSurface.color(snapshot.mutedColor, DEFAULT_MUTED),
      accent = WidgetSurface.color(snapshot.accentColor, DEFAULT_ACCENT),
    )
  }
}
