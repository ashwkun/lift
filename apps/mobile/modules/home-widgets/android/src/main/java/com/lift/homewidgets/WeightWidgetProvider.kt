package com.lift.homewidgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.util.TypedValue
import android.widget.RemoteViews

/**
 * The bodyweight tile: your last weigh-in, and one tap to log the next.
 *
 * There are no buttons on it, and that is a decision rather than an omission. A
 * widget cannot show a keyboard, so the only way to enter a number on the home
 * screen is a pair of steppers — and a real weigh-in moves by 0.5 to 1.5 kg
 * against a 0.1 kg step, which is five to fifteen taps to say something the
 * keypad says in three. Worse, committing it from here would mean writing to the
 * database from the launcher's process: a second implementation of
 * `recordMeasurement`, its oplog entry and its bodyweight mirror, running
 * concurrently with the app's own handle on the same file.
 *
 * So the tile reads, and the app writes. A tap lands on
 * `/measurement/bodyweight?log=<token>`, the same route and the same convention
 * the weigh-in reminder's notification uses, which opens the entry sheet with
 * the keypad up and the last reading prefilled. The token is the publisher's
 * doing and is described there; nothing here interprets it.
 */
class WeightWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    val views = build(context, WidgetSnapshot.load(context))
    for (id in appWidgetIds) manager.updateAppWidget(id, views)
  }

  companion object {
    /** Distinct from every other request code in this module. See `WidgetSurface.open`. */
    private const val REQUEST_WEIGHT = 300

    /** Enough for "82.4 kg"; too much for a sentence. */
    private const val READING_SP = 26f
    private const val PROMPT_SP = 16f

    fun render(context: Context, manager: AppWidgetManager, snapshot: WidgetSnapshot) {
      val ids = manager.getAppWidgetIds(ComponentName(context, WeightWidgetProvider::class.java))
      if (ids.isEmpty()) return

      // One `RemoteViews` for every placement: unlike the routines widget,
      // nothing here depends on the size of the tile it lands in.
      manager.updateAppWidget(ids, build(context, snapshot))
    }

    private fun build(context: Context, snapshot: WidgetSnapshot): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.widget_weight)

      val palette = WidgetPalette.from(snapshot)

      WidgetSurface.tint(views, R.id.weight_backdrop, palette.surface)
      WidgetSurface.tint(views, R.id.weight_mark, palette.accent)

      views.setTextColor(R.id.weight_label, palette.muted)
      views.setTextColor(R.id.weight_value, palette.text)
      views.setTextColor(R.id.weight_detail, palette.muted)

      views.setTextViewText(R.id.weight_value, snapshot.weightValue)
      views.setTextViewText(R.id.weight_detail, snapshot.weightDetail)
      views.setTextViewTextSize(
        R.id.weight_value,
        TypedValue.COMPLEX_UNIT_SP,
        if (snapshot.weightLogged) READING_SP else PROMPT_SP,
      )

      // Read as one sentence rather than three fragments: TalkBack announces a
      // widget's children in layout order, and "Bodyweight, 82.4, kg, minus,
      // 0.3" is not what the tile says.
      views.setContentDescription(
        R.id.weight_root,
        "${context.getString(R.string.widget_weight_label)}. " +
          "${snapshot.weightValue}. ${snapshot.weightDetail}",
      )

      views.setOnClickPendingIntent(
        R.id.weight_root,
        WidgetSurface.open(context, snapshot.weightLink, REQUEST_WEIGHT),
      )

      return views
    }
  }
}
