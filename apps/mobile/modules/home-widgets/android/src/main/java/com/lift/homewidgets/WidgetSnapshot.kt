package com.lift.homewidgets

import android.content.Context
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.json.JSONArray
import org.json.JSONObject

/**
 * One tappable row of the routines widget.
 *
 * Carries the link rather than a routine id. Which route a routine opens, and
 * what it says when it gets there, is a question about the app's router, and
 * this module is on the wrong side of the bridge to have an opinion about it.
 * The cost is a full URL per row instead of a uuid; the benefit is that adding
 * a query parameter to the start link is a one-line change in TypeScript rather
 * than a matched pair of edits across two languages.
 */
class WidgetRow(
  @Field val name: String = "",
  @Field val meta: String = "",
  @Field val link: String = WidgetSnapshot.LINK_APP,
) : Record

/**
 * Everything both widgets draw, as pushed from JavaScript and as kept on disk.
 *
 * Every string in here arrived formatted. There is no date arithmetic, no unit
 * conversion and no pluralisation anywhere in this module, because all three
 * already exist in `@lift/shared` and a second copy of any of them would
 * eventually disagree with the app it sits beside on the same screen. The empty
 * state is a row like any other for the same reason: "No routines yet" is a
 * sentence the app writes, not a branch this module takes.
 *
 * The one exception, and the reason it is an exception, is `activeStartedAtMs`:
 * a resume banner reading "24:31" would be wrong within a second of being
 * published, so what crosses the bridge is the epoch and the launcher's own
 * `Chronometer` renders the difference. `WorkoutLiveState.kt` makes the same
 * trade for the same reason.
 */
class WidgetSnapshot(
  /** "82.4 kg", or the prompt shown when nothing has been logged. */
  @Field val weightValue: String = "Log weight",

  /** "−0.3 kg · 2 days ago", or the prompt's second line. */
  @Field val weightDetail: String = "Open Lift to start",

  /**
   * Whether `weightValue` is a reading or a prompt.
   *
   * Only decides the type size. A reading is three or four glyphs and wants to
   * be the largest thing on the tile; a prompt is a sentence and does not fit
   * there at all.
   */
  @Field val weightLogged: Boolean = false,

  @Field val weightLink: String = LINK_APP,

  /**
   * The routines, in the user's own order, already capped by the publisher to
   * `RoutinesWidgetProvider.MAX_SLOTS`. Exactly one row when there are none.
   */
  @Field val rows: List<WidgetRow> = emptyList(),

  /** The always-last row: an ad-hoc session with no routine behind it. */
  @Field val startLabel: String = "Start empty workout",
  @Field val startLink: String = LINK_APP,

  /** The open session's name, or null. Turns the header into a resume banner. */
  @Field val activeTitle: String? = null,

  /** Epoch ms it started. Ticked by the launcher, never by this app. */
  @Field val activeStartedAtMs: Double? = null,

  /** Where the header goes: the open session, or the routines list. */
  @Field val headerLink: String = LINK_APP,

  /**
   * `#RRGGBB`, all five from whichever of the eight palettes is in use.
   *
   * The defaults are `darkPalette` in `theme/tokens.ts`, which is what a widget
   * added before the app has ever run is painted in. It is the app's default
   * theme, so for most people that guess is also the right answer.
   */
  @Field val surfaceColor: String = "#1A1A1A",
  @Field val rowColor: String = "#2A2A2A",
  @Field val textColor: String = "#F5F7F8",
  @Field val mutedColor: String = "#B8BEC5",
  @Field val accentColor: String = "#D2F34B",
) : Record {

  private fun toJson(): String {
    val rowArray = JSONArray()
    for (row in rows) {
      rowArray.put(
        JSONObject()
          .put(KEY_NAME, row.name)
          .put(KEY_META, row.meta)
          .put(KEY_LINK, row.link),
      )
    }

    return JSONObject()
      .put(KEY_WEIGHT_VALUE, weightValue)
      .put(KEY_WEIGHT_DETAIL, weightDetail)
      .put(KEY_WEIGHT_LOGGED, weightLogged)
      .put(KEY_WEIGHT_LINK, weightLink)
      .put(KEY_ROWS, rowArray)
      .put(KEY_START_LABEL, startLabel)
      .put(KEY_START_LINK, startLink)
      // `put(String, Object)` with null *removes* the key, which is exactly the
      // shape `isNull` below expects for "there is no open session".
      .put(KEY_ACTIVE_TITLE, activeTitle)
      .put(KEY_ACTIVE_STARTED_AT, activeStartedAtMs)
      .put(KEY_HEADER_LINK, headerLink)
      .put(KEY_SURFACE, surfaceColor)
      .put(KEY_ROW, rowColor)
      .put(KEY_TEXT, textColor)
      .put(KEY_MUTED, mutedColor)
      .put(KEY_ACCENT, accentColor)
      .toString()
  }

  companion object {
    /**
     * The one route this module knows, and only as a fallback.
     *
     * Reached exactly when a widget is drawn before the app has ever published:
     * a restored home screen on a fresh install, or a `pm clear`. Every other
     * link on both widgets arrives in the snapshot.
     */
    const val LINK_APP = "lift://workout"

    /**
     * Its own file rather than the app's default preferences.
     *
     * A widget is drawn in whichever process the launcher happened to ask, which
     * for a cold home screen is not the process that wrote this. Every read
     * therefore opens the file fresh, and keeping it to one small document of
     * our own means that read is a few hundred bytes rather than everything the
     * app has ever stored.
     */
    private const val PREFS = "com.lift.homewidgets.snapshot"
    private const val KEY_SNAPSHOT = "snapshot"

    private const val KEY_NAME = "name"
    private const val KEY_META = "meta"
    private const val KEY_LINK = "link"
    private const val KEY_WEIGHT_VALUE = "weightValue"
    private const val KEY_WEIGHT_DETAIL = "weightDetail"
    private const val KEY_WEIGHT_LOGGED = "weightLogged"
    private const val KEY_WEIGHT_LINK = "weightLink"
    private const val KEY_ROWS = "rows"
    private const val KEY_START_LABEL = "startLabel"
    private const val KEY_START_LINK = "startLink"
    private const val KEY_ACTIVE_TITLE = "activeTitle"
    private const val KEY_ACTIVE_STARTED_AT = "activeStartedAtMs"
    private const val KEY_HEADER_LINK = "headerLink"
    private const val KEY_SURFACE = "surfaceColor"
    private const val KEY_ROW = "rowColor"
    private const val KEY_TEXT = "textColor"
    private const val KEY_MUTED = "mutedColor"
    private const val KEY_ACCENT = "accentColor"

    fun save(context: Context, snapshot: WidgetSnapshot) {
      // `commit` rather than `apply`: the very next thing the caller does is ask
      // the launcher to redraw, and the launcher's read happens in another
      // process, which an asynchronous write may not have reached yet.
      context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(KEY_SNAPSHOT, snapshot.toJson())
        .commit()
    }

    /**
     * The last published description, or the defaults above.
     *
     * Never throws and never returns null. This runs on the launcher's behalf,
     * from a broadcast, in a process that may exist for no other reason — the
     * one outcome worth ruling out entirely is the one where a malformed
     * document takes the home screen down with it.
     */
    fun load(context: Context): WidgetSnapshot {
      val stored = runCatching {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SNAPSHOT, null)
      }.getOrNull() ?: return WidgetSnapshot()

      return runCatching { parse(JSONObject(stored)) }.getOrElse { WidgetSnapshot() }
    }

    private fun parse(json: JSONObject): WidgetSnapshot {
      val defaults = WidgetSnapshot()
      val rowArray = json.optJSONArray(KEY_ROWS) ?: JSONArray()
      val rows = ArrayList<WidgetRow>(rowArray.length())

      for (index in 0 until rowArray.length()) {
        val row = rowArray.optJSONObject(index) ?: continue
        rows.add(
          WidgetRow(
            name = row.optString(KEY_NAME),
            meta = row.optString(KEY_META),
            link = row.optString(KEY_LINK, LINK_APP),
          ),
        )
      }

      return WidgetSnapshot(
        weightValue = json.optString(KEY_WEIGHT_VALUE, defaults.weightValue),
        weightDetail = json.optString(KEY_WEIGHT_DETAIL, defaults.weightDetail),
        weightLogged = json.optBoolean(KEY_WEIGHT_LOGGED, defaults.weightLogged),
        weightLink = json.optString(KEY_WEIGHT_LINK, defaults.weightLink),
        rows = rows,
        startLabel = json.optString(KEY_START_LABEL, defaults.startLabel),
        startLink = json.optString(KEY_START_LINK, defaults.startLink),
        // `isNull` rather than `has`: a key written from a JavaScript null lands
        // as JSON's null rather than being absent, and `optString` would hand
        // back the four characters "null" for it.
        activeTitle = if (json.isNull(KEY_ACTIVE_TITLE)) null else json.optString(KEY_ACTIVE_TITLE),
        activeStartedAtMs =
          if (json.isNull(KEY_ACTIVE_STARTED_AT)) null else json.optDouble(KEY_ACTIVE_STARTED_AT),
        headerLink = json.optString(KEY_HEADER_LINK, defaults.headerLink),
        surfaceColor = json.optString(KEY_SURFACE, defaults.surfaceColor),
        rowColor = json.optString(KEY_ROW, defaults.rowColor),
        textColor = json.optString(KEY_TEXT, defaults.textColor),
        mutedColor = json.optString(KEY_MUTED, defaults.mutedColor),
        accentColor = json.optString(KEY_ACCENT, defaults.accentColor),
      )
    }
  }
}
