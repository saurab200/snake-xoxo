package com.tether.modules

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.tether.core.FocusSessionStore
import com.tether.core.Prefs
import com.tether.core.RNBridge
import com.tether.core.TetherEvents
import com.tether.core.TetherService

/** JS <-> FocusSessionStore. Person A owns this. */
class FocusModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "TetherFocus"

    /** Start the foreground service. Call once the user has granted permissions. */
    @ReactMethod
    fun arm(promise: Promise) {
        TetherService.start(reactContext)
        promise.resolve(true)
    }

    @ReactMethod
    fun disarm(promise: Promise) {
        TetherService.stop(reactContext)
        promise.resolve(true)
    }

    @ReactMethod
    fun startSession(minutes: Int, blocklist: ReadableArray, promise: Promise) {
        val blocked = (0 until blocklist.size()).mapNotNull { blocklist.getString(it) }.toSet()
        FocusSessionStore.start(minutes, blocked)
        TetherService.start(reactContext) // idempotent; guarantees the ticker is running
        emitSessionChanged()
        promise.resolve(state())
    }

    @ReactMethod
    fun stopSession(promise: Promise) {
        FocusSessionStore.stop()
        emitSessionChanged()
        promise.resolve(state())
    }

    @ReactMethod
    fun getState(promise: Promise) {
        promise.resolve(state())
    }

    /** Lets the blocklist be edited mid-session from the settings screen. */
    @ReactMethod
    fun setBlocklist(blocklist: ReadableArray, promise: Promise) {
        val next = (0 until blocklist.size()).mapNotNull { blocklist.getString(it) }.toSet()
        FocusSessionStore.blocklist = next
        Prefs.setStringSet(reactContext, Prefs.KEY_BLOCKLIST, next)
        promise.resolve(true)
    }

    /** Person C: packages that should pop the integration widget. */
    @ReactMethod
    fun setWidgetTriggers(packages: ReadableArray, promise: Promise) {
        FocusSessionStore.widgetTriggers =
            (0 until packages.size()).mapNotNull { packages.getString(it) }.toSet()
        promise.resolve(true)
    }

    private fun state(): WritableMap = Arguments.createMap().apply {
        putBoolean("isActive", FocusSessionStore.isActive)
        putInt("durationMinutes", FocusSessionStore.durationMinutes)
        putDouble("endAtMs", FocusSessionStore.endAtMs.toDouble())
        putDouble("remainingMs", FocusSessionStore.remainingMs().toDouble())
        putInt("remainingMinutes", FocusSessionStore.remainingMinutes())
    }

    private fun emitSessionChanged() =
        RNBridge.emit(reactContext, TetherEvents.SESSION_CHANGED, state())
}
