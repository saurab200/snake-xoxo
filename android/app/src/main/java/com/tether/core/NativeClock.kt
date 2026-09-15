package com.tether.core

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.facebook.react.bridge.Arguments

/**
 * A CLOCK FOR ANIMATIONS, OWNED BY NATIVE.
 *
 * The overlays are on screen precisely when Tether is backgrounded, and in that
 * state React Native advances neither `Animated` (native driver included) nor JS
 * timers -- so anything tweened in JS freezes part-way and strands whatever it
 * was drawing. See HANDOFF.md section 10; it has cost this codebase four bugs.
 *
 * What *does* still work backgrounded is a re-render driven by a native event --
 * that is why the session timer pill counts down. So this is the ticker the
 * timer pill has, generalised: `start(id, durationMs)` emits `tether:clock`
 * about thirty times a second with `t` running 0 -> 1, and JS redraws each
 * frame. The motion is real because the clock is native; only the painting is
 * JS.
 *
 * Every run is bounded twice over -- by the duration cap here and by a final
 * frame that removes the Runnable -- because a 30fps bridge loop that failed to
 * stop would be a far worse bug than the missing animation it was added for.
 */
object NativeClock {

    private const val TAG = "NativeClock"

    /** ~30fps: reads as motion, and stays cheap enough on the bridge. */
    private const val FRAME_MS = 33L

    /**
     * Nothing in this app animates for longer than a flourish. The cap is what
     * turns a bad caller into a short animation rather than a runaway ticker.
     */
    private const val MAX_DURATION_MS = 3000L

    /** The service's own looper: it keeps running whatever the JS thread does. */
    private val main = Handler(Looper.getMainLooper())

    /** Frame Runnables of the runs currently in flight, keyed by run id. */
    private val runs = mutableMapOf<Int, Runnable>()

    /**
     * Run the clock for `durationMs`, emitting progress to JS until it lands.
     *
     * Starting a run with an id that is already running replaces it -- the
     * caller has superseded its own animation, and two tickers writing the same
     * id would interleave frames.
     */
    fun start(context: Context, id: Int, durationMs: Long) {
        val app = context.applicationContext
        main.post {
            stop(app, id, notify = false) // this run supersedes any earlier one

            val duration = durationMs.coerceIn(1L, MAX_DURATION_MS)
            val startedAt = SystemClock.uptimeMillis()

            val frame = object : Runnable {
                override fun run() {
                    val elapsed = SystemClock.uptimeMillis() - startedAt
                    val done = elapsed >= duration
                    emit(app, id, (elapsed.toFloat() / duration).coerceIn(0f, 1f), done)
                    if (done) {
                        runs.remove(id)
                    } else {
                        main.postDelayed(this, FRAME_MS)
                    }
                }
            }

            runs[id] = frame
            main.postDelayed(frame, FRAME_MS)
            Log.d(TAG, "run $id started for ${duration}ms")
        }
    }

    /** Stop a run early. JS still gets a final frame, so nothing freezes mid-way. */
    fun cancel(context: Context, id: Int) {
        val app = context.applicationContext
        main.post { stop(app, id, notify = true) }
    }

    /** Main thread only. */
    private fun stop(context: Context, id: Int, notify: Boolean) {
        val frame = runs.remove(id) ?: return
        main.removeCallbacks(frame)
        if (notify) {
            emit(context, id, 1f, true)
        }
    }

    private fun emit(context: Context, id: Int, t: Float, done: Boolean) {
        val params = Arguments.createMap().apply {
            putInt("id", id)
            putDouble("t", t.toDouble())
            putBoolean("done", done)
        }
        RNBridge.emit(context, TetherEvents.CLOCK, params)
    }
}
