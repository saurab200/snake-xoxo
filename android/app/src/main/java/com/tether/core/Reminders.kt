package com.tether.core

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Scheduled tasks that trigger a total lockout when they fall due.
 *
 * Deliberately NOT using AlarmManager: exact alarms need SCHEDULE_EXACT_ALARM on
 * Android 12+, which is a restricted permission with a Play policy attached.
 * Tether already runs a foreground service with a 1s ticker, so due-checking
 * there is free and needs no new permission.
 *
 * The trade-off: reminders only fire while the service is alive. That is
 * acceptable because a lockout is meaningless if Tether is not running anyway.
 */
object Reminders {

    private const val KEY = "reminders"

    data class Reminder(
        val id: String,
        val title: String,
        val dueAtMs: Long,
        val lockMinutes: Int,
        val fired: Boolean,
    )

    fun all(context: Context): List<Reminder> {
        val raw = Prefs.getString(context, KEY) ?: return emptyList()
        return try {
            val array = JSONArray(raw)
            (0 until array.length()).map { i ->
                val o = array.getJSONObject(i)
                Reminder(
                    id = o.getString("id"),
                    title = o.optString("title"),
                    dueAtMs = o.optLong("dueAtMs"),
                    lockMinutes = o.optInt("lockMinutes", 25),
                    fired = o.optBoolean("fired", false),
                )
            }.sortedBy { it.dueAtMs }
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun save(context: Context, reminders: List<Reminder>) {
        val array = JSONArray()
        reminders.forEach { r ->
            array.put(
                JSONObject().apply {
                    put("id", r.id)
                    put("title", r.title)
                    put("dueAtMs", r.dueAtMs)
                    put("lockMinutes", r.lockMinutes)
                    put("fired", r.fired)
                }
            )
        }
        Prefs.setString(context, KEY, array.toString())
    }

    fun add(context: Context, reminder: Reminder) {
        save(context, all(context) + reminder)
    }

    fun remove(context: Context, id: String) {
        save(context, all(context).filterNot { it.id == id })
    }

    /**
     * Returns the first reminder that has just fallen due, marking it fired so it
     * cannot trigger twice. Called once per second from TetherService.
     */
    /** A reminder more than this far overdue is stale -- see takeDue. */
    private const val STALE_AFTER_MS = 10 * 60_000L

    fun takeDue(context: Context, now: Long = System.currentTimeMillis()): Reminder? {
        val current = all(context)

        // Only fire reminders that came due recently. If the service was stopped
        // (the kill switch does exactly that) a reminder whose time passed while
        // it was off would otherwise ambush the user with a lockout the moment
        // they restart. Stale ones are marked fired and skipped.
        val stale = current.filter { !it.fired && it.dueAtMs in 1 until (now - STALE_AFTER_MS) }
        if (stale.isNotEmpty()) {
            val staleIds = stale.map { it.id }.toSet()
            save(context, current.map { if (it.id in staleIds) it.copy(fired = true) else it })
            return takeDue(context, now)
        }

        val due = current.firstOrNull { !it.fired && it.dueAtMs in 1..now } ?: return null
        save(context, current.map { if (it.id == due.id) it.copy(fired = true) else it })
        return due
    }
}
