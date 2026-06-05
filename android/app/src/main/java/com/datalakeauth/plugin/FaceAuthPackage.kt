package com.datalakeauth.plugin

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.mrousavy.camera.frameprocessor.FrameProcessorPluginRegistry

/**
 * React Native Package that registers our Frame Processor Plugin.
 *
 * This class must be added to the getPackages() list in MainApplication.kt:
 *
 *   override fun getPackages(): List<ReactPackage> {
 *       val packages = PackageList(this).packages.toMutableList()
 *       packages.add(FaceAuthPackage())
 *       return packages
 *   }
 *
 * After registration, the plugin is available in JS as:
 *
 *   import { useFrameProcessor } from 'react-native-vision-camera'
 *   import { faceAuth } from './faceAuthPlugin'
 *
 *   const frameProcessor = useFrameProcessor((frame) => {
 *     'worklet'
 *     const result = faceAuth(frame)
 *   }, [])
 */
class FaceAuthPackage : ReactPackage {

    init {
        // Register the frame processor plugin with Vision Camera
        FrameProcessorPluginRegistry.addFrameProcessorPlugin("faceAuth") { proxy, options ->
            FaceAuthFrameProcessorPlugin(proxy, options)
        }
    }

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(
            FaceAuthModule(reactContext),
            DeviceTimeModule(reactContext)
        )
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
