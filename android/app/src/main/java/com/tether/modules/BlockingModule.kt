package com.tether.modules

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.tether.blocking.AppList
import com.tether.blocking.TetherAccessibilityService

/** JS <-> blocking engine. Person B owns this. */
class BlockingModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "TetherBlocking"

    @ReactMethod
    fun isAccessibilityEnabled(promise: Promise) {
        promise.resolve(TetherAccessibilityService.isEnabled(reactContext))
    }

    @ReactMethod
    fun openAccessibilitySettings(promise: Promise) {
        TetherAccessibilityService.openSettings(reactContext)
        promise.resolve(true)
    }

    @ReactMethod
    fun getInstalledApps(promise: Promise) {
        val array = Arguments.createArray()
        AppList.installed(reactContext).forEach { entry ->
            array.pushMap(
                Arguments.createMap().apply {
                    putString("packageName", entry.packageName)
                    putString("label", entry.label)
                }
            )
        }
        promise.resolve(array)
    }

    @ReactMethod
    fun getSuggestedBlocklist(promise: Promise) {
        val array = Arguments.createArray()
        AppList.SUGGESTED_BLOCKLIST.forEach { array.pushString(it) }
        promise.resolve(array)
    }
}
