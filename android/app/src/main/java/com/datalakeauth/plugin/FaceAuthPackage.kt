package com.datalakeauth.plugin

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.datalakeauth.camerax.CameraXViewManager

/**
 * React Native Package that registers:
 *  1. FaceAuthModule (NativeModules.FaceAuthSQLite) — JS-to-native SQLite bridge
 *  2. DeviceTimeModule — device time utility
 *  3. CameraXViewManager — native <CameraXView> component for face auth
 */
class FaceAuthPackage : ReactPackage {

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(
            FaceAuthModule(reactContext),
            DeviceTimeModule(reactContext)
        )
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return listOf(CameraXViewManager())
    }
}
