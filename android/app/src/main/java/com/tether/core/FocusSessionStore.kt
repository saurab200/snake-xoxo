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

    /* ---- LOCKOUT ----------------------------------------------------
     * A second, stricter blocking mode, independent of focus sessions.
     * Triggered when a reminder falls due. While locked out, blocked apps are
     * closed on sight rather than merely covered, and there is no escape hatch.
     */

    @Volatile
    var lockoutUntilMs: Long = 0L
        private set

    /** The reminder title that caused the lockout, shown on the wall. */
    @Volatile
    var lockoutLabel: String? = null
        private set

    fun startLockout(untilMs: Long, label: String?) {
        lockoutUntilMs = untilMs
        lockoutLabel = label
    }

    fun stopLockout() {
        lockoutUntilMs = 0L
        lockoutLabel = null
    }

    fun isLockedOut(): Boolean = lockoutUntilMs > System.currentTimeMillis()

    fun lockoutRemainingMs(): Long =
        (lockoutUntilMs - System.currentTimeMillis()).coerceAtLeast(0L)

    /** Packages whose foreground event should surface an integration widget. */
    @Volatile
    var widgetTriggers: Set<String> = emptySet()

    fun start(minutes: Int, blocked: Set<String>) {
        durationMinutes = minutes
        endAtMs = System.currentTimeMillis() + minutes * 60_000L
        blocklist = blocked
        isActive = true
    }

    /**
     * Restore a session that was running before the process died.
     *
     * Distinct from start() on purpose: start() computes endAtMs from a duration,
     * which would round the remaining time up on every restore and let a session
     * drift longer each time the process is killed. This preserves the original
     * deadline exactly.
     */
    fun restore(endAt: Long, minutes: Int, blocked: Set<String>) {
        if (endAt <= System.currentTimeMillis()) return
        endAtMs = endAt
        durationMinutes = minutes
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

    /**
     * A package is blocked during a focus session OR during a lockout. Person 2's
     * accessibility service calls this on every app switch.
     */
    fun isBlocked(pkg: String): Boolean =
        (isActive || isLockedOut()) && blocklist.contains(pkg)
}
