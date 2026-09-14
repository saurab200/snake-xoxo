package com.tether.modules

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.tether.core.Prefs

/** Minimal key/value store. Same shape as AsyncStorage, minus the dependency. */
class StorageModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "TetherStorage"

    @ReactMethod
    fun getItem(key: String, promise: Promise) {
        promise.resolve(Prefs.getString(reactContext, key))
    }

    @ReactMethod
    fun setItem(key: String, value: String, promise: Promise) {
        Prefs.setString(reactContext, key, value)
        promise.resolve(true)
    }

    @ReactMethod
    fun getStringArray(key: String, promise: Promise) {
        val array = Arguments.createArray()
        Prefs.getStringSet(reactContext, key).forEach { array.pushString(it) }
        promise.resolve(array)
    }

    @ReactMethod
    fun setStringArray(key: String, values: ReadableArray, promise: Promise) {
        Prefs.setStringSet(
            reactContext,
            key,
            (0 until values.size()).mapNotNull { values.getString(it) },
        )
        promise.resolve(true)
    }
}
