package com.tether.overlay

import android.content.Context
import android.graphics.PixelFormat
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.WindowManager
import com.facebook.react.ReactRootView
import com.tether.core.RNBridge

/**
 * Renders REACT NATIVE components into floating system windows.
 *
 * This is the piece that makes React Native viable for this app: instead of
 * hand-drawing the snake / block screen / widget in Kotlin Canvas code, each one
 * is a normal RN component registered in index.js, mounted into a WindowManager
 * window that floats over every other app.
 *
 * Usage from JS:  Overlay.show('SnakeOverlay', { height: 160, gravity: 'top' })
 *
 * Requires SYSTEM_ALERT_WINDOW ("Draw over other apps"), which is a settings
 * screen the user must visit -- see PermissionsModule.
 */
object OverlayManager {

    private const val TAG = "OverlayManager"
    private val main = Handler(Looper.getMainLooper())
    private val views = mutableMapOf<String, ReactRootView>()

    const val MATCH_PARENT = -1
    const val WRAP_CONTENT = -2

    data class Config(
        /** dp, or MATCH_PARENT / WRAP_CONTENT */
        val width: Int = MATCH_PARENT,
        val height: Int = WRAP_CONTENT,
        val x: Int = 0,
        val y: Int = 0,
        val gravity: String = "top",
        /** false => the window never takes key input (back button passes through) */
        val focusable: Boolean = false,
        /** true => touches outside this view's bounds go to the app underneath */
        val touchThrough: Boolean = true,
    )

    fun canDraw(context: Context): Boolean = Settings.canDrawOverlays(context)

    fun isShowing(name: String): Boolean = views.containsKey(name)

    fun show(context: Context, name: String, config: Config, props: Bundle?) {
        val app = context.applicationContext
        if (!canDraw(app)) {
            Log.w(TAG, "show($name) ignored: SYSTEM_ALERT_WINDOW not granted")
            return
        }
        main.post {
            if (views.containsKey(name)) {
                // Already up -- just push new props.
                views[name]?.appProperties = props ?: Bundle()
                return@post
            }
            try {
                val rootView = ReactRootView(app)
                rootView.startReactApplication(
                    RNBridge.instanceManager(app),
                    name,
                    props ?: Bundle(),
                )
                windowManager(app).addView(rootView, layoutParams(app, config))
                views[name] = rootView
            } catch (t: Throwable) {
                Log.e(TAG, "failed to show overlay $name", t)
            }
        }
    }

    /** Resize/move an existing window without remounting React. */
    fun setLayout(context: Context, name: String, config: Config) {
        val app = context.applicationContext
        main.post {
            val view = views[name] ?: return@post
            try {
                windowManager(app).updateViewLayout(view, layoutParams(app, config))
            } catch (t: Throwable) {
                Log.e(TAG, "failed to relayout overlay $name", t)
            }
        }
    }

    fun update(name: String, props: Bundle) {
        main.post { views[name]?.appProperties = props }
    }

    fun hide(context: Context, name: String) {
        val app = context.applicationContext
        main.post {
            val view = views.remove(name) ?: return@post
            try {
                windowManager(app).removeView(view)
                view.unmountReactApplication()
            } catch (t: Throwable) {
                Log.e(TAG, "failed to hide overlay $name", t)
            }
        }
    }

    fun hideAll(context: Context) {
        views.keys.toList().forEach { hide(context, it) }
    }

    // --- internals -------------------------------------------------------

    private fun windowManager(context: Context) =
        context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

    private fun layoutParams(context: Context, c: Config): WindowManager.LayoutParams {
        var flags = WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
        if (!c.focusable) flags = flags or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
        if (c.touchThrough) flags = flags or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL

        return WindowManager.LayoutParams(
            dimen(context, c.width),
            dimen(context, c.height),
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            flags,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = parseGravity(c.gravity)
            x = dp(context, c.x)
            y = dp(context, c.y)
        }
    }

    private fun dimen(context: Context, value: Int): Int = when (value) {
        MATCH_PARENT -> WindowManager.LayoutParams.MATCH_PARENT
        WRAP_CONTENT -> WindowManager.LayoutParams.WRAP_CONTENT
        else -> dp(context, value)
    }

    private fun dp(context: Context, value: Int): Int =
        (value * context.resources.displayMetrics.density).toInt()

    private fun parseGravity(name: String): Int = when (name) {
        "top" -> Gravity.TOP or Gravity.CENTER_HORIZONTAL
        "bottom" -> Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
        "center" -> Gravity.CENTER
        "topLeft" -> Gravity.TOP or Gravity.START
        "topRight" -> Gravity.TOP or Gravity.END
        "bottomLeft" -> Gravity.BOTTOM or Gravity.START
        "bottomRight" -> Gravity.BOTTOM or Gravity.END
        else -> Gravity.TOP or Gravity.CENTER_HORIZONTAL
    }
}
