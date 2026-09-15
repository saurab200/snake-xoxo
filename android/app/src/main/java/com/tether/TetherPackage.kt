package com.tether

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.tether.modules.BlockingModule
import com.tether.modules.ClockModule
import com.tether.modules.FocusModule
import com.tether.modules.OverlayModule
import com.tether.modules.PermissionsModule
import com.tether.modules.RemindersModule
import com.tether.modules.StorageModule

class TetherPackage : ReactPackage {

    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
        listOf(
            FocusModule(context),
            OverlayModule(context),
            ClockModule(context),
            BlockingModule(context),
            PermissionsModule(context),
            StorageModule(context),
            RemindersModule(context),
        )

    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
