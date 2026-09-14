package com.tether.core

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import com.facebook.react.bridge.Arguments
import com.tether.MainActivity
import com.tether.overlay.OverlayManager

/**
 * Foreground service. Two jobs:
 *
 *  1. Keep the app process alive so the overlays and the 1s ticker survive the
 *     user leaving the app. Android kills background processes; a foreground
 *     service with a visible notification is the only reliable way around that.
 *  2. Own the countdown. The tick runs in Kotlin, not JS, so the timer keeps
 *     running correctly even if the JS thread is idle or the overlay is hidden.
 *
 * Person 1 (Person A) owns this file.
 */
class TetherService : Service() {

    companion object {
        private const val CHANNEL_ID = "tether_focus"
        private const val CHANNEL_DONE_ID = "tether_done"
        private const val NOTIFICATION_ID = 42
        private const val NOTIFICATION_DONE_ID = 43
        private const val TICK_MS = 1000L

        const val ACTION_START = "com.tether.START"
        const val ACTION_STOP = "com.tether.STOP"

        fun start(context: Context) {
            context.startForegroundService(
                Intent(context, TetherService::class.java).setAction(ACTION_START)
            )
        }

        fun stop(context: Context) {
            context.startService(
                Intent(context, TetherService::class.java).setAction(ACTION_STOP)
            )
        }
    }

    private val handler = Handler(Looper.getMainLooper())
    private var ticking = false

    /** Guards against the 1s tick re-running end-of-session side effects. */
    private var endHandled = false

    private val tick = object : Runnable {
        override fun run() {
            if (!ticking) return

            if (FocusSessionStore.isActive) {
                endHandled = false
                val remaining = FocusSessionStore.remainingMs()

                if (remaining <= 0L) {
                    endSession(completed = true)
                } else {
                    RNBridge.emit(
                        this@TetherService,
                        TetherEvents.TICK,
                        Arguments.createMap().apply {
                            putDouble("remainingMs", remaining.toDouble())
                            putInt("remainingMinutes", FocusSessionStore.remainingMinutes())
                        },
                    )
                    updateNotification()
                }
            }
            handler.postDelayed(this, TICK_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                endSession(completed = false)
                stopTicking()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                // Restores a session that was running when the process died.
                Prefs.hydrate(this)
                createChannels()
                startForeground(NOTIFICATION_ID, buildNotification())
                startTicking()
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopTicking()
        OverlayManager.hideAll(this)
        super.onDestroy()
    }

    private fun startTicking() {
        if (ticking) return
        ticking = true
        handler.post(tick)
    }

    private fun stopTicking() {
        ticking = false
        handler.removeCallbacks(tick)
    }

    private fun endSession(completed: Boolean) {
        if (endHandled) return
        endHandled = true

        val wasActive = FocusSessionStore.isActive
        FocusSessionStore.stop()
        Prefs.clearSession(this)
        OverlayManager.hide(this, "BlockOverlay")

        RNBridge.emit(
            this,
            TetherEvents.SESSION_CHANGED,
            Arguments.createMap().apply {
                putBoolean("isActive", false)
                putInt("durationMinutes", 0)
                putDouble("endAtMs", 0.0)
                putDouble("remainingMs", 0.0)
                putInt("remainingMinutes", 0)
            },
        )

        // Only celebrate a session that actually ran to completion.
        if (completed && wasActive) {
            vibrateDone()
            notifyDone()
        }
        updateNotification()
    }

    // --- feedback ---------------------------------------------------------

    private fun vibrateDone() {
        try {
            val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
            if (!vibrator.hasVibrator()) return
            vibrator.vibrate(
                VibrationEffect.createWaveform(longArrayOf(0, 180, 120, 180), -1)
            )
        } catch (e: Exception) {
            // Emulators and some devices have no vibrator. Never fatal.
        }
    }

    private fun notifyDone() {
        val notification = Notification.Builder(this, CHANNEL_DONE_ID)
            .setContentTitle("Focus session complete")
            .setContentText("Nice work.")
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setContentIntent(contentIntent())
            .setAutoCancel(true)
            .build()
        notificationManager().notify(NOTIFICATION_DONE_ID, notification)
    }

    // --- notification -----------------------------------------------------

    private fun notificationManager() =
        getSystemService(NOTIFICATION_SERVICE) as NotificationManager

    private fun createChannels() {
        // Ongoing timer: silent, it updates every second.
        notificationManager().createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Focus session",
                NotificationManager.IMPORTANCE_LOW,
            ).apply { setShowBadge(false) }
        )
        // Completion: must actually make a sound, so a separate channel.
        notificationManager().createNotificationChannel(
            NotificationChannel(
                CHANNEL_DONE_ID,
                "Session complete",
                NotificationManager.IMPORTANCE_DEFAULT,
            )
        )
    }

    private fun contentIntent(): PendingIntent = PendingIntent.getActivity(
        this,
        0,
        Intent(this, MainActivity::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** getService, not getActivity -- this fires straight back into onStartCommand. */
    private fun stopAction(): Notification.Action {
        val pending = PendingIntent.getService(
            this,
            1,
            Intent(this, TetherService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return Notification.Action.Builder(null, "End session", pending).build()
    }

    private fun buildNotification(): Notification {
        val active = FocusSessionStore.isActive
        val builder = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Tether")
            .setContentText(
                if (active) "${formatRemaining(FocusSessionStore.remainingMs())} left"
                else "Ready -- drag the snake to start"
            )
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setContentIntent(contentIntent())
            .setOngoing(true)
            .setOnlyAlertOnce(true)

        if (active) builder.addAction(stopAction())
        return builder.build()
    }

    private fun updateNotification() =
        notificationManager().notify(NOTIFICATION_ID, buildNotification())

    /** M:SS, so the notification visibly counts down instead of sitting on a minute. */
    private fun formatRemaining(ms: Long): String {
        val total = (ms / 1000).coerceAtLeast(0)
        return "%d:%02d".format(total / 60, total % 60)
    }
}
