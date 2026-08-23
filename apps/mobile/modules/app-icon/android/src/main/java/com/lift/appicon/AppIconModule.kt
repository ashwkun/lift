package com.lift.appicon

import android.content.ComponentName
import android.content.Context
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Which launcher icon is showing.
 *
 * Android has no API for recolouring an app icon, so this is a switch rather
 * than a painter: every theme's icon is already in the APK behind an
 * `<activity-alias>`, and all this module does is enable one and disable the
 * rest. `plugins/with-theme-launcher-icons.ts` is where the aliases and the
 * artwork come from, and it is worth reading first.
 *
 * ## Nothing here holds a list of themes
 *
 * The aliases are discovered from the package manager by name prefix rather
 * than hardcoded, so a theme added to the plugin's table appears here with no
 * Kotlin change. The only thing the two halves have to agree on is
 * `<package>.Launcher`, which the plugin's comment also records.
 *
 * ## What the user sees when this runs
 *
 * The launcher notices a component change and redraws its list, so the app's
 * icon (and, on most launchers, its home screen shortcut) blinks. Two things
 * keep that from being worse than a blink: `DONT_KILL_APP`, without which the
 * package manager stops the process mid-workout to apply the change, and the
 * order below, which enables the new alias before disabling the old ones so the
 * app is never briefly a package with no launcher entry at all. Some launchers
 * drop a shortcut to a component that disappears, even momentarily.
 */
class AppIconModule : Module() {

  companion object {
    /**
     * Shared with the config plugin, and only this. See the class comment.
     *
     * Matching is on the alias name after this prefix, case-insensitively, so
     * `com.lift.app.LauncherGruvbox` answers to `"gruvbox"`.
     */
    private const val ALIAS_PREFIX = "Launcher"
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AppIcon")

    /**
     * The theme whose icon is currently showing, or null if the package manager
     * reports none enabled, which it should never do.
     *
     * Synchronous because it is one already-cached package query and the caller
     * uses it to decide whether there is anything to do at all.
     */
    Function("getIcon") {
      aliases().firstOrNull { isEnabled(it) }?.let { themeOf(it) }
    }

    /**
     * Shows the named theme's icon.
     *
     * Returns false when no alias matches, which means a build whose JavaScript
     * knows a theme its APK does not: an over-the-air update that added one,
     * before the native rebuild that would ship its icon. That is a real state
     * and not an error, so it resolves rather than throwing, and the icon simply
     * stays where it was.
     */
    AsyncFunction("setIcon") { theme: String ->
      val all = aliases()
      val target = all.firstOrNull { themeOf(it).equals(theme, ignoreCase = true) }
        ?: return@AsyncFunction false

      // Cheap, and worth it: every one of these calls makes the launcher redraw,
      // and this is called on every theme change, including the ones that land
      // back on the icon already showing.
      if (isEnabled(target) && all.none { it.name != target.name && isEnabled(it) }) {
        return@AsyncFunction true
      }

      setEnabled(target.name, true)
      all.filter { it.name != target.name }.forEach { setEnabled(it.name, false) }
      true
    }
  }

  /**
   * Every launcher alias in this package, enabled or not.
   *
   * `MATCH_DISABLED_COMPONENTS` is the whole point: all but one of these are
   * disabled at any moment, and without it the query returns only the one that
   * is already showing.
   */
  private fun aliases(): List<ActivityInfo> {
    val packageManager = context.packageManager
    val flags = PackageManager.GET_ACTIVITIES or PackageManager.MATCH_DISABLED_COMPONENTS

    val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      packageManager.getPackageInfo(
        context.packageName,
        PackageManager.PackageInfoFlags.of(flags.toLong()),
      )
    } else {
      @Suppress("DEPRECATION")
      packageManager.getPackageInfo(context.packageName, flags)
    }

    return info.activities.orEmpty().filter { it.name.startsWith(aliasPrefix()) }
  }

  private fun aliasPrefix(): String = "${context.packageName}.$ALIAS_PREFIX"

  private fun themeOf(alias: ActivityInfo): String =
    alias.name.removePrefix(aliasPrefix()).lowercase()

  /**
   * Whether this alias is the one showing.
   *
   * Three states rather than two, because a component nobody has ever switched
   * reports DEFAULT rather than ENABLED, and DEFAULT means "whatever the
   * manifest said". That is the state every alias is in on a fresh install, so
   * reading it as anything else would make the first `setIcon` of a new install
   * disable the icon it had just enabled.
   */
  private fun isEnabled(alias: ActivityInfo): Boolean {
    val component = ComponentName(context.packageName, alias.name)
    return when (context.packageManager.getComponentEnabledSetting(component)) {
      PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
      PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> alias.enabled
      else -> false
    }
  }

  private fun setEnabled(name: String, enabled: Boolean) {
    val state = if (enabled) {
      PackageManager.COMPONENT_ENABLED_STATE_ENABLED
    } else {
      PackageManager.COMPONENT_ENABLED_STATE_DISABLED
    }

    context.packageManager.setComponentEnabledSetting(
      ComponentName(context.packageName, name),
      state,
      PackageManager.DONT_KILL_APP,
    )
  }
}
