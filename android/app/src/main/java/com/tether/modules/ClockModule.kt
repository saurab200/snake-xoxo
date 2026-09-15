package com.tether.modules

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.tether.core.NativeClock

/**
 * JS <-> the native animation clock.
 *
 * JS asks for a run and then only paints; the frames arrive as `tether:clock`
 * events. See NativeClock for why an animation in this app cannot be timed in
 * JS at all.
 */
class ClockModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "TetherClock"

    @ReactMethod
    fun start(id: Double, durationMs: Double, promise: Promise) {
        NativeClock.start(reactContext, id.toInt(), durationMs.toLong())
        promise.resolve(true)
    }

    @ReactMethod
    fun cancel(id: Double, promise: Promise) {
        NativeClock.cancel(reactContext, id.toInt())
        promise.resolve(true)
    }
}
