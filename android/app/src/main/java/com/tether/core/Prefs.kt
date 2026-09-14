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
    }
}
