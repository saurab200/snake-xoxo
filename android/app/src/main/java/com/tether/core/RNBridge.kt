package com.tether.core

import android.content.Context
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceManager
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Helpers for talking to JS from places that are NOT a ReactModule --
 * i.e. our foreground service and the accessibility service.
 */
object RNBridge {

    fun instanceManager(context: Context): ReactInstanceManager =
        (context.applicationContext as ReactApplication).reactNativeHost.reactInstanceManager

    /**
     * The AccessibilityService can start the process before the user ever opens the
     * app, in which case there is no JS context yet. Call this to spin one up.
     */
    fun ensureContext(context: Context) {
        val rim = instanceManager(context)
        if (rim.currentReactContext == null && !rim.hasStartedCreatingInitialContext()) {
            rim.createReactContextInBackground()
        }
    }

    fun reactContext(context: Context): ReactContext? =
        instanceManager(context).currentReactContext

    /** Fire-and-forget event to JS. Silently no-ops if JS is not up yet. */
    fun emit(context: Context, event: String, params: WritableMap?) {
        val ctx = reactContext(context) ?: return
        if (!ctx.hasActiveReactInstance()) return
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, params)
    }
}

/** Event names. Keep these in sync with src/native/events.ts */
object TetherEvents {
    const val TICK = "tether:tick"                 // { remainingMs, remainingMinutes }
    const val SESSION_CHANGED = "tether:session"   // { isActive, durationMinutes, endAtMs }
    const val FOREGROUND_APP = "tether:foregroundApp" // { packageName, blocked }
    const val LOCKOUT_CHANGED = "tether:lockout"   // { isLockedOut, lockoutUntilMs, ... }
    const val REMINDERS_CHANGED = "tether:reminders" // {}
    const val CLOCK = "tether:clock"               // { id, t, done } -- see NativeClock
}
