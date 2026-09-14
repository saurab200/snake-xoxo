package com.tether

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.soloader.SoLoader
import com.tether.core.FocusSessionStore
import com.tether.core.Prefs
import com.tether.core.TetherService

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              add(TetherPackage())
            }

        override fun getJSMainModuleName(): String = "index"

        override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

        override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }

  override val reactHost: ReactHost
    get() = getDefaultReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    SoLoader.init(this, false)
    restoreSessionIfAny()
    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      // If you opted-in for the New Architecture, we load the native entry point for this app.
      load()
    }
  }

  /**
   * Bring a live session back after the process died.
   *
   * This runs on EVERY process start -- activity, service, or accessibility
   * service -- which is the only hook that covers all of them.
   *
   * TetherService returns START_STICKY, which handles an OOM kill on its own. It
   * does NOT cover an explicit force-stop: Android deliberately suppresses sticky
   * restarts until the user launches the app again. Without this, reopening after
   * a force-stop showed an idle app while the persisted session was still ticking
   * down in storage.
   */
  private fun restoreSessionIfAny() {
    try {
      Prefs.hydrate(this)
      if (FocusSessionStore.isActive) {
        TetherService.start(this)
      }
    } catch (e: Exception) {
      // Android 12+ can refuse a background foreground-service start. Not fatal:
      // the session is still in Prefs and restores next time the app is opened.
    }
  }
}
