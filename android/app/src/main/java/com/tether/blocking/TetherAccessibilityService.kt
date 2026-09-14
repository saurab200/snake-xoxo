package com.tether.blocking

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.view.accessibility.AccessibilityEvent
import com.facebook.react.bridge.Arguments
import com.tether.core.FocusSessionStore
import com.tether.core.Prefs
import com.tether.core.RNBridge
import com.tether.core.TetherEvents
import com.tether.overlay.OverlayManager

/**
 * Detects which app just came to the foreground.
 *
 * Person 2 (Person B) owns this file.
 *
 * Note the ordering: the blocklist check reads FocusSessionStore DIRECTLY (same
 * process, no bridge), so a blocked app is caught in under a millisecond. The
 * event to JS is fired afterwards and is only for Person 3's widget logic -- never
 * put the blocking decision behind the bridge, it is too slow and JS may be asleep.
 */
class TetherAccessibilityService : AccessibilityService() {

    companion object {
        private const val SERVICE_ID = "com.tether/com.tether.blocking.TetherAccessibilityService"

        /**
         * Packages we never treat as an app switch.
         *
         * The launcher is deliberately NOT in here. Going home is how the user
         * escapes the block wall, and we need that event to dismiss it.
         */
        private val IGNORED = setOf(
            "com.tether",
            "com.android.systemui",
            "android",
        )

        fun isEnabled(context: Context): Boolean {
            val enabled = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
            ) ?: return false
            val splitter = TextUtils.SimpleStringSplitter(':')
            splitter.setString(enabled)
            while (splitter.hasNext()) {
                if (splitter.next().equals(SERVICE_ID, ignoreCase = true)) return true
            }
            return false
        }

        fun openSettings(context: Context) {
            context.startActivity(
                Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
    }

    private var lastPackage: String? = null

    /**
     * Resolved once at connect time. Keyboards fire window-state-changed events
     * constantly; treating them as app switches churns the handler and would hide
     * the block wall every time a keyboard opened.
     */
    private var ignoredDynamic: Set<String> = emptySet()

    override fun onServiceConnected() {
        super.onServiceConnected()
        // This service can start the process before the user ever opens the app,
        // so load the persisted blocklist ourselves rather than waiting for JS.
        Prefs.hydrate(this)
        ignoredDynamic = resolveIgnored()
        RNBridge.ensureContext(this)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val pkg = event.packageName?.toString() ?: return
        if (pkg in IGNORED || pkg in ignoredDynamic) return

        val blocked = FocusSessionStore.isBlocked(pkg)

        // Dedup identical consecutive events -- but never for a blocked app, or
        // dismissing the wall while still inside that app would leave it dismissed.
        if (pkg == lastPackage && !blocked) return
        lastPackage = pkg

        if (blocked) {
            onBlockedAppOpened(pkg)
        } else {
            // The user genuinely navigated away from the blocked app (usually via
            // Home), so take the wall down.
            OverlayManager.hide(this, "BlockOverlay")
        }

        // For Person 3: "user just opened Canvas, show the todo widget".
        // Must fire for EVERY foreground change, blocked or not.
        RNBridge.emit(
            this,
            TetherEvents.FOREGROUND_APP,
            Arguments.createMap().apply {
                putString("packageName", pkg)
                putBoolean("blocked", blocked)
            },
        )
    }

    override fun onInterrupt() = Unit

    private fun onBlockedAppOpened(pkg: String) {
        // Deliberately NOT calling performGlobalAction(GLOBAL_ACTION_HOME) here.
        //
        // It used to. Going home fires a fresh window-state-changed event for the
        // launcher, which is not blocked, which ran the hide branch above -- so the
        // wall appeared and vanished within a frame or two. The full-screen
        // focusable overlay already prevents interaction with the app underneath,
        // so forcing home bought nothing and cost the entire feature.
        OverlayManager.show(
            context = this,
            name = "BlockOverlay",
            config = OverlayManager.Config(
                width = OverlayManager.MATCH_PARENT,
                height = OverlayManager.MATCH_PARENT,
                gravity = "center",
                focusable = true,
                touchThrough = false,
            ),
            props = Bundle().apply {
                putString("packageName", pkg)
                putString("appLabel", AppList.labelFor(this@TetherAccessibilityService, pkg))
                putInt("remainingMinutes", FocusSessionStore.remainingMinutes())
            },
        )
    }

    /** Input methods only. See the comment on IGNORED for why not the launcher. */
    private fun resolveIgnored(): Set<String> {
        val result = mutableSetOf<String>()
        try {
            val ime = Settings.Secure.getString(
                contentResolver,
                Settings.Secure.DEFAULT_INPUT_METHOD,
            )
            // Stored as "com.pkg/.ServiceName"
            ime?.substringBefore('/')?.takeIf { it.isNotBlank() }?.let(result::add)
        } catch (e: Exception) {
            // Non-fatal: we just lose keyboard filtering.
        }
        return result
    }

    /** Resolved lazily; only used by AppList for the "which app is home" question. */
    fun launcherPackage(): String? = try {
        packageManager.resolveActivity(
            Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME),
            PackageManager.MATCH_DEFAULT_ONLY,
        )?.activityInfo?.packageName
    } catch (e: Exception) {
        null
    }
}
