package com.lift.homewidgets

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The JavaScript surface: one verb.
 *
 * Everything about *what* a routine is, which weigh-in is the newest, how a
 * kilogram is spelled in the user's units and which of the eight palettes is on,
 * is decided in TypeScript against SQLite and the settings store, and arrives
 * here already rendered into strings and hex. Nothing in this module knows what
 * a workout is, and nothing in it can change one — the same division
 * `WorkoutLiveModule` draws, and for the same reason: the app has exactly one
 * description of itself and this is a painter for it.
 *
 * There is no matching `read`. The widgets never send anything back; a tap is a
 * deep link into the app, so the only channel is one-way and there is no queue
 * to drain.
 */
class HomeWidgetsModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("HomeWidgets")

    /**
     * Stores the description, then redraws whatever is on a home screen.
     *
     * In that order, and both every time. Storing unconditionally is what makes
     * a widget added tomorrow open on today's routines rather than on nothing;
     * redrawing afterwards costs one binder call when no widget is placed, which
     * is the common case.
     *
     * Async because the write is `commit()` rather than `apply()` — see the note
     * on `WidgetSnapshot.save` for why it has to be — and a synchronous file
     * write on the JS thread is a frame this app does not have to spend.
     */
    AsyncFunction("publish") { snapshot: WidgetSnapshot ->
      WidgetSnapshot.save(context, snapshot)
      WidgetSurface.refresh(context)
    }
  }
}
