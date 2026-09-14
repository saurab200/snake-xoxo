package com.tether.admin

import android.app.admin.DeviceAdminReceiver

/**
 * Required receiver for Device Owner mode.
 *
 * Tether needs Device Owner only for one API: DevicePolicyManager
 * .setApplicationHidden(), which removes a blocked app's icon from the launcher
 * entirely. That is the only way a third-party app can make another app
 * genuinely unreachable -- there is no API to dim or disable someone else's
 * launcher icon, and the launcher is a separate app we cannot reach into.
 *
 * Provisioned once over adb on a device with no accounts:
 *
 *   adb shell dpm set-device-owner com.tether/com.tether.admin.TetherDeviceAdmin
 */
class TetherDeviceAdmin : DeviceAdminReceiver()
