package com.tether.modules

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.tether.core.FocusSessionStore
import com.tether.core.RNBridge
import com.tether.core.Reminders
import com.tether.core.TetherEvents
import com.tether.core.TetherService

/** JS <-> reminders + lockout. */
class RemindersModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "TetherReminders"

    @ReactMethod
    fun list(promise: Promise) {
        val array = Arguments.createArray()
        Reminders.all(reactContext).forEach { r ->
            array.pushMap(
                Arguments.createMap().apply {
                    putString("id", r.id)
                    putString("title", r.title)
                    putDouble("dueAtMs", r.dueAtMs.toDouble())
                    putInt("lockMinutes", r.lockMinutes)
                    putBoolean("fired", r.fired)
                }
            )
        }
        promise.resolve(array)
    }

    @ReactMethod
    fun add(reminder: ReadableMap, promise: Promise) {
        val entry = Reminders.Reminder(
            id = System.currentTimeMillis().toString(),
            title = reminder.getString("title") ?: "Reminder",
            dueAtMs = reminder.getDouble("dueAtMs").toLong(),
            lockMinutes = if (reminder.hasKey("lockMinutes")) reminder.getInt("lockMinutes") else 25,
            fired = false,
        )
        Reminders.add(reactContext, entry)
        // The ticker is what fires reminders, so it must be running.
        TetherService.start(reactContext)
        RNBridge.emit(reactContext, TetherEvents.REMINDERS_CHANGED, Arguments.createMap())
        promise.resolve(true)
    }

    @ReactMethod
    fun remove(id: String, promise: Promise) {
        Reminders.remove(reactContext, id)
        RNBridge.emit(reactContext, TetherEvents.REMINDERS_CHANGED, Arguments.createMap())
        promise.resolve(true)
    }

    @ReactMethod
    fun getLockout(promise: Promise) {
        promise.resolve(lockoutState())
    }

    /** Manual trigger, for demoing the lockout without waiting for a due date. */
    @ReactMethod
    fun startLockout(minutes: Int, label: String?, promise: Promise) {
        FocusSessionStore.startLockout(
            System.currentTimeMillis() + minutes * 60_000L,
            label ?: "Manual lockout",
        )
        TetherService.start(reactContext)
        RNBridge.emit(reactContext, TetherEvents.LOCKOUT_CHANGED, lockoutState())
        promise.resolve(true)
    }

    @ReactMethod
    fun stopLockout(promise: Promise) {
        FocusSessionStore.stopLockout()
        RNBridge.emit(reactContext, TetherEvents.LOCKOUT_CHANGED, lockoutState())
        promise.resolve(true)
    }

    private fun lockoutState(): WritableMap = Arguments.createMap().apply {
        putBoolean("isLockedOut", FocusSessionStore.isLockedOut())
        putDouble("lockoutUntilMs", FocusSessionStore.lockoutUntilMs.toDouble())
        putDouble("lockoutRemainingMs", FocusSessionStore.lockoutRemainingMs().toDouble())
        putString("lockoutLabel", FocusSessionStore.lockoutLabel)
    }
}
