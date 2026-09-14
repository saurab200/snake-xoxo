package com.tether.core

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Brings the snake back after a reboot.
 *
 * The snake is meant to live on the screen from power-on until the user
 * explicitly closes it with the kill switch -- not just until the next restart.
 *
 * BOOT_COMPLETED is one of the few broadcasts still allowed to start a
 * foreground service from the background on Android 12+, which is why this
 * works at all.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_LOCKED_BOOT_COMPLETED
        ) {
            return
        }

        // Respect an explicit close: the kill switch disarms, and staying shut
        // through a reboot is the whole point of "stop everything".
        if (!Prefs.isArmed(context)) return

        try {
            TetherService.start(context)
        } catch (e: Exception) {
            // Some OEMs still refuse; nothing else we can do from a receiver.
        }
    }
}
