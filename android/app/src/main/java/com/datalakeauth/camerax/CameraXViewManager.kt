package com.datalakeauth.camerax

import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/**
 * React Native ViewManager that bridges CameraXView to JS.
 *
 * Usage in JS:
 *   <CameraXView
 *     style={StyleSheet.absoluteFill}
 *     mode="registration"
 *     isActive={true}
 *     isCaptureRequested={false}
 *     onFaceAuthResult={(e) => handleResult(e.nativeEvent)}
 *   />
 */
class CameraXViewManager : SimpleViewManager<CameraXView>() {

    override fun getName(): String = "CameraXView"

    override fun createViewInstance(reactContext: ThemedReactContext): CameraXView {
        return CameraXView(reactContext)
    }

    @ReactProp(name = "mode")
    fun setMode(view: CameraXView, mode: String) {
        view.mode = mode
    }

    @ReactProp(name = "isActive", defaultBoolean = false)
    fun setIsActive(view: CameraXView, isActive: Boolean) {
        view.isActive = isActive
    }

    @ReactProp(name = "isCaptureRequested", defaultBoolean = false)
    fun setIsCaptureRequested(view: CameraXView, isCaptureRequested: Boolean) {
        view.isCaptureRequested = isCaptureRequested
    }

    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any>? {
        return MapBuilder.of(
            "onFaceAuthResult",
            MapBuilder.of("registrationName", "onFaceAuthResult")
        )
    }

    override fun onDropViewInstance(view: CameraXView) {
        view.dispose()
        super.onDropViewInstance(view)
    }
}
