package com.tether.modules

import android.os.Bundle
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.tether.overlay.OverlayManager

/**
 * JS <-> floating windows.
 *
 * `name` must match a component registered with AppRegistry in index.js.
 * Shared by Person A (snake) and Person C (widget).
 */
class OverlayModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "TetherOverlay"

    override fun getConstants(): Map<String, Any> = mapOf(
        "MATCH_PARENT" to OverlayManager.MATCH_PARENT,
        "WRAP_CONTENT" to OverlayManager.WRAP_CONTENT,
    )

    @ReactMethod
    fun show(name: String, options: ReadableMap?, props: ReadableMap?, promise: Promise) {
        OverlayManager.show(
            reactContext,
            name,
            configFrom(options),
            props?.let { Arguments.toBundle(it) },
        )
        promise.resolve(true)
    }

    /** Resize or move a visible overlay. Remounts nothing -- React state is preserved. */
    @ReactMethod
    fun setLayout(name: String, options: ReadableMap?, promise: Promise) {
        OverlayManager.setLayout(reactContext, name, configFrom(options))
        promise.resolve(true)
    }

    /**
     * Resize after a delay, timed natively.
     *
     * For resizes that have to happen when an animation finishes: JS timers and
     * animation callbacks are not delivered while Tether is backgrounded, which
     * is when the overlays are actually on screen. See OverlayManager.
     */
    @ReactMethod
    fun setLayoutAfter(name: String, options: ReadableMap?, delayMs: Double, promise: Promise) {
        OverlayManager.setLayoutAfter(reactContext, name, configFrom(options), delayMs.toLong())
        promise.resolve(true)
    }

    /** Push new props into an already-visible overlay without re-creating it. */
    @ReactMethod
    fun update(name: String, props: ReadableMap, promise: Promise) {
        OverlayManager.update(name, Arguments.toBundle(props) ?: Bundle())
        promise.resolve(true)
    }

    @ReactMethod
    fun hide(name: String, promise: Promise) {
        OverlayManager.hide(reactContext, name)
        promise.resolve(true)
    }

    @ReactMethod
    fun hideAll(promise: Promise) {
        OverlayManager.hideAll(reactContext)
        promise.resolve(true)
    }

    @ReactMethod
    fun isShowing(name: String, promise: Promise) {
        promise.resolve(OverlayManager.isShowing(name))
    }

    private fun configFrom(options: ReadableMap?) = OverlayManager.Config(
        width = options.intOr("width", OverlayManager.MATCH_PARENT),
        height = options.intOr("height", OverlayManager.WRAP_CONTENT),
        x = options.intOr("x", 0),
        y = options.intOr("y", 0),
        gravity = options?.takeIf { it.hasKey("gravity") }?.getString("gravity") ?: "top",
        focusable = options.boolOr("focusable", false),
        touchThrough = options.boolOr("touchThrough", true),
    )

    private fun ReadableMap?.intOr(key: String, fallback: Int): Int =
        if (this != null && hasKey(key) && !isNull(key)) getInt(key) else fallback

    private fun ReadableMap?.boolOr(key: String, fallback: Boolean): Boolean =
        if (this != null && hasKey(key) && !isNull(key)) getBoolean(key) else fallback
}
