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
 * Person A owns this file.
 */
class TetherService : Service() {

    companion object {
        private const val CHANNEL_ID = "tether_focus"
        private const val NOTIFICATION_ID = 42
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

    private val tick = object : Runnable {
        override fun run() {
            if (!ticking) return

            if (FocusSessionStore.isActive) {
                val remaining = FocusSessionStore.remainingMs()

                if (remaining <= 0L) {
                    endSession()
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
                endSession()
                stopTicking()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                Prefs.hydrate(this)
                createChannel()
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

    private fun endSession() {
        FocusSessionStore.stop()
        OverlayManager.hide(this, "BlockOverlay")
        RNBridge.emit(
            this,
            TetherEvents.SESSION_CHANGED,
            Arguments.createMap().apply {
                putBoolean("isActive", false)
                putInt("durationMinutes", 0)
                putDouble("endAtMs", 0.0)
            },
        )
        updateNotification()
    }

    // --- notification ----------------------------------------------------

    private fun createChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Focus session",
            NotificationManager.IMPORTANCE_LOW,
        ).apply { setShowBadge(false) }
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
            .createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val text = if (FocusSessionStore.isActive) {
            "${FocusSessionStore.remainingMinutes()} min left"
        } else {
            "Ready -- drag the snake to start"
        }

        val tap = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Tether")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setContentIntent(tap)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification() {
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIFICATION_ID, buildNotification())
    }
}
