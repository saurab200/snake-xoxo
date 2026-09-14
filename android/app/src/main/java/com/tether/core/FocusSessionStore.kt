package com.tether.core

/**
 * THE SHARED CONTRACT.
 *
 * Person A writes to this (via FocusModule).
 * Person B reads it (from TetherAccessibilityService, synchronously, no bridge hop).
 * Person C reads it for widget visibility.
 *
 * This is a plain Kotlin object, so it is a singleton for the whole app process --
 * which includes the AccessibilityService. That is why blocking decisions can be
 * made in <1ms without waiting on JS.
 */
object FocusSessionStore {

    @Volatile
    var isActive: Boolean = false
        private set

    /** Wall-clock ms when the session ends. 0 when inactive. */
    @Volatile
    var endAtMs: Long = 0L
        private set

    @Volatile
    var durationMinutes: Int = 0
        private set

    /** Package names that are blocked while a session is active. */
    @Volatile
    var blocklist: Set<String> = emptySet()

    /** Packages whose foreground event should surface an integration widget. */
    @Volatile
    var widgetTriggers: Set<String> = emptySet()

    fun start(minutes: Int, blocked: Set<String>) {
        durationMinutes = minutes
        endAtMs = System.currentTimeMillis() + minutes * 60_000L
        blocklist = blocked
        isActive = true
    }

    fun stop() {
        isActive = false
        endAtMs = 0L
        durationMinutes = 0
    }

    fun remainingMs(): Long =
        if (!isActive) 0L else (endAtMs - System.currentTimeMillis()).coerceAtLeast(0L)

    fun remainingMinutes(): Int = Math.ceil(remainingMs() / 60_000.0).toInt()

    fun isBlocked(pkg: String): Boolean = isActive && blocklist.contains(pkg)
}
