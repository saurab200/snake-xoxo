package com.tether.blocking

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
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
 * Person B owns this file.
 *
 * Note the ordering: the blocklist check reads FocusSessionStore DIRECTLY (same
 * process, no bridge), so a blocked app is caught in under a millisecond. The
 * event to JS is fired afterwards and is only for Person C's widget logic -- never
 * put the blocking decision behind the bridge, it is too slow and JS may be asleep.
 */
class TetherAccessibilityService : AccessibilityService() {

    companion object {
        private const val SERVICE_ID = "com.tether/com.tether.blocking.TetherAccessibilityService"

        /** Packages we never react to, or we would fight the system UI. */
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

    override fun onServiceConnected() {
        super.onServiceConnected()
        // This service can start the process before the user ever opens the app,
        // so load the persisted blocklist ourselves rather than waiting for JS.
        Prefs.hydrate(this)
        RNBridge.ensureContext(this)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val pkg = event.packageName?.toString() ?: return
        if (pkg in IGNORED) return
        if (pkg == lastPackage) return
        lastPackage = pkg

        val blocked = FocusSessionStore.isBlocked(pkg)

        if (blocked) {
            onBlockedAppOpened(pkg)
        } else {
            OverlayManager.hide(this, "BlockOverlay")
        }

        // For Person C: "user just opened Canvas, show the todo widget".
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

        // Belt and braces: also bounce them to the launcher. Comment this out if the
        // overlay alone feels better in the demo.
        performGlobalAction(GLOBAL_ACTION_HOME)
    }
}
