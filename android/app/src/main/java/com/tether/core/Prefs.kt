package com.tether.core

import android.content.Context
import org.json.JSONArray

/**
 * Persistence. Deliberately native rather than AsyncStorage: the blocklist has to
 * be readable by the AccessibilityService at boot, before any JS has run.
 */
object Prefs {

    private const val FILE = "tether"

    const val KEY_BLOCKLIST = "blocklist"
    /** Whether the snake should be on screen. Cleared by the kill switch. */
    const val KEY_ARMED = "armed"
    const val KEY_SESSION_END_AT = "session.endAt"
    const val KEY_SESSION_DURATION = "session.duration"
    const val KEY_CANVAS_TOKEN = "canvas.token"
    const val KEY_CANVAS_HOST = "canvas.host"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun getString(context: Context, key: String): String? =
        prefs(context).getString(key, null)

    fun setString(context: Context, key: String, value: String) {
        prefs(context).edit().putString(key, value).apply()
    }

    fun getStringSet(context: Context, key: String): Set<String> {
        val raw = getString(context, key) ?: return emptySet()
        return try {
            val array = JSONArray(raw)
            (0 until array.length()).map { array.getString(it) }.toSet()
        } catch (e: Exception) {
            emptySet()
        }
    }

    fun setStringSet(context: Context, key: String, values: Collection<String>) {
        setString(context, key, JSONArray(values.toList()).toString())
    }

    /**
     * Load persisted config into the in-memory store. Safe to call repeatedly.
     * Called from both services so whichever starts first wins.
     */
    fun hydrate(context: Context) {
        if (FocusSessionStore.blocklist.isEmpty()) {
            FocusSessionStore.blocklist = getStringSet(context, KEY_BLOCKLIST)
        }
        restoreSession(context)
    }

    /** Default true: a fresh install should show the snake once permitted. */
    fun isArmed(context: Context): Boolean =
        getString(context, KEY_ARMED) != "0"

    fun setArmed(context: Context, armed: Boolean) {
        setString(context, KEY_ARMED, if (armed) "1" else "0")
    }

    /** Called when a session starts, so it can outlive the process. */
    fun saveSession(context: Context, endAtMs: Long, durationMinutes: Int) {
        setString(context, KEY_SESSION_END_AT, endAtMs.toString())
        setString(context, KEY_SESSION_DURATION, durationMinutes.toString())
    }

    fun clearSession(context: Context) {
        setString(context, KEY_SESSION_END_AT, "0")
        setString(context, KEY_SESSION_DURATION, "0")
    }

    /**
     * Bring back a session that was running when the process died. Android
     * restarts the foreground service (START_STICKY) but with empty memory, so
     * without this the timer silently disappears after an OOM kill or force-stop.
     */
    private fun restoreSession(context: Context) {
        if (FocusSessionStore.isActive) return

        val endAt = getString(context, KEY_SESSION_END_AT)?.toLongOrNull() ?: 0L
        val minutes = getString(context, KEY_SESSION_DURATION)?.toIntOrNull() ?: 0

        // Never resurrect a session that expired while we were dead.
        if (endAt <= System.currentTimeMillis()) {
            if (endAt != 0L) clearSession(context)
            return
        }
        FocusSessionStore.restore(endAt, minutes, getStringSet(context, KEY_BLOCKLIST))
    }
}
