package com.tether.modules

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.tether.blocking.TetherAccessibilityService
import com.tether.overlay.OverlayManager

/**
 * Every permission this app needs is a "go to a settings screen" permission, not a
 * runtime dialog. Each opener below just launches the right Settings intent; the
 * JS side re-checks status when the app comes back to the foreground.
 */
class PermissionsModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "TetherPermissions"

    @ReactMethod
    fun getStatus(promise: Promise) {
        promise.resolve(
            Arguments.createMap().apply {
                putBoolean("overlay", OverlayManager.canDraw(reactContext))
                putBoolean("accessibility", TetherAccessibilityService.isEnabled(reactContext))
                putBoolean("notifications", hasNotificationPermission())
            }
        )
    }

    @ReactMethod
    fun openOverlaySettings(promise: Promise) {
        launch(
            Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:${reactContext.packageName}"),
            )
        )
        promise.resolve(true)
    }

    @ReactMethod
    fun openAccessibilitySettings(promise: Promise) {
        launch(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        promise.resolve(true)
    }

    @ReactMethod
    fun openNotificationSettings(promise: Promise) {
        launch(
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, reactContext.packageName)
        )
        promise.resolve(true)
    }

    private fun launch(intent: Intent) {
        reactContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun hasNotificationPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return reactContext.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }
}
