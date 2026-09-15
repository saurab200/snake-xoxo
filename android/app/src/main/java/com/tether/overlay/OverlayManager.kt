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

    /** Last layout params per overlay, needed to re-add a window when raising it. */
    private val params = mutableMapOf<String, WindowManager.LayoutParams>()

    /**
     * Resizes scheduled for later by setLayoutAfter, one per overlay.
     *
     * Kept so an immediate setLayout, a hide, or a second schedule can cancel a
     * pending one -- otherwise a stale resize could fire in the middle of the
     * next gesture and shrink the window out from under it.
     */
    private val pendingLayouts = mutableMapOf<String, Runnable>()

    /**
     * Overlays that must stay above every other overlay.
     *
     * Window z-order among TYPE_APPLICATION_OVERLAY windows is add-order, so the
     * full-screen block wall -- added later -- buried the panic button and made it
     * unreachable during a lockout, which is exactly when it matters most.
     */
    private val ALWAYS_ON_TOP = setOf("KillSwitchOverlay")

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
                val lp = layoutParams(app, config)
                windowManager(app).addView(rootView, lp)
                views[name] = rootView
                params[name] = lp
                if (name !in ALWAYS_ON_TOP) raiseAlwaysOnTop(app)
            } catch (t: Throwable) {
                Log.e(TAG, "failed to show overlay $name", t)
            }
        }
    }

    /** Resize/move an existing window without remounting React. */
    fun setLayout(context: Context, name: String, config: Config) {
        val app = context.applicationContext
        main.post {
            cancelPending(name) // an explicit resize beats anything scheduled
            applyLayout(app, name, config)
        }
    }

    /**
     * Resize LATER, from the native main looper.
     *
     * JS cannot be trusted to do this itself. While Tether is backgrounded --
     * which is the normal case for every overlay -- RN's timers and the
     * completion callbacks of native-driver animations are not delivered, so a
     * `setTimeout` scheduled to shrink a window after an animation may never
     * run. The snake's drag window is 170x440dp, so losing that callback strands
     * a large invisible slab over the launcher and clips the session pills.
     *
     * This Handler is the service's own main looper and keeps running whatever
     * the JS side is doing.
     */
    fun setLayoutAfter(context: Context, name: String, config: Config, delayMs: Long) {
        val app = context.applicationContext
        main.post {
            cancelPending(name)
            val task = Runnable {
                Log.d(TAG, "deferred relayout firing for $name -> ${config.width}x${config.height}")
                pendingLayouts.remove(name)
                applyLayout(app, name, config)
            }
            pendingLayouts[name] = task
            Log.d(TAG, "scheduling relayout of $name in ${delayMs}ms -> ${config.width}x${config.height}")
            main.postDelayed(task, delayMs.coerceAtLeast(0L))
        }
    }

    private fun cancelPending(name: String) {
        pendingLayouts.remove(name)?.let { main.removeCallbacks(it) }
    }

    /** Main thread only. */
    private fun applyLayout(app: Context, name: String, config: Config) {
        val view = views[name]
        if (view == null) {
            Log.w(TAG, "applyLayout($name): no such window")
            return
        }
        try {
            val lp = layoutParams(app, config)
            params[name] = lp
            windowManager(app).updateViewLayout(view, lp)
        } catch (t: Throwable) {
            Log.e(TAG, "failed to relayout overlay $name", t)
        }
    }

    fun update(name: String, props: Bundle) {
        main.post { views[name]?.appProperties = props }
    }

    fun hide(context: Context, name: String) {
        val app = context.applicationContext
        main.post {
            cancelPending(name)
            val view = views.remove(name) ?: return@post
            params.remove(name)
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

    /**
     * Detach and re-attach the always-on-top windows so they sit above whatever
     * was just added. The ReactRootView is NOT unmounted, so React state and any
     * running animation survive the move.
     */
    private fun raiseAlwaysOnTop(context: Context) {
        ALWAYS_ON_TOP.forEach { name ->
            val view = views[name] ?: return@forEach
            val lp = params[name] ?: return@forEach
            try {
                windowManager(context).removeViewImmediate(view)
                windowManager(context).addView(view, lp)
            } catch (t: Throwable) {
                Log.e(TAG, "failed to raise $name", t)
            }
        }
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
