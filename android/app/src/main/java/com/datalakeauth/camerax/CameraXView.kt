package com.datalakeauth.camerax

import android.content.Context
import android.util.Size
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.events.RCTEventEmitter
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Native Android View that hosts a CameraX preview and face-auth analysis.
 *
 * Registered as "CameraXView" in React Native via CameraXViewManager.
 * Replaces react-native-vision-camera's <Camera> component.
 *
 * Props from JS:
 *   mode: "registration" | "attendance"
 *   isActive: boolean
 *   isCaptureRequested: boolean
 *
 * Events:
 *   onFaceAuthResult: { nativeEvent: FaceAuthResult }
 */
class CameraXView(context: Context) : FrameLayout(context) {

    private val previewView = PreviewView(context).apply {
        layoutParams = LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        implementationMode = PreviewView.ImplementationMode.PERFORMANCE
        scaleType = PreviewView.ScaleType.FILL_CENTER
    }

    private var cameraExecutor: ExecutorService? = null
    private var cameraProvider: ProcessCameraProvider? = null
    private var boundUseCases: Array<UseCase> = emptyArray()
    private var imageAnalysis: ImageAnalysis? = null
    private var analyzer: FaceAuthAnalyzer? = null
    private var generation = 0L
    private var analysisGeneration = 0L
    private var disposed = false
    private var currentMode = "attendance"
    private var currentCaptureRequested = false
    private var previewObserver: Observer<PreviewView.StreamState>? = null

    init {
        addView(previewView)
    }

    override fun requestLayout() {
        super.requestLayout()
        post {
            measure(
                MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
                MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
            )
            layout(left, top, right, bottom)
        }
    }

    // ── Props ────────────────────────────────────────────────

    var isActive: Boolean = false
        set(value) {
            if (field != value) {
                field = value
                analyzer?.isActive = value
                if (value) startCamera() else stopCamera()
            }
        }

    var mode: String
        get() = currentMode
        set(value) {
            if (currentMode != value) {
                currentMode = value
                if (isActive) { stopCamera(); startCamera() }
            }
        }

    var isCaptureRequested: Boolean
        get() = currentCaptureRequested
        set(value) {
            if (currentCaptureRequested == value) return
            currentCaptureRequested = value
            analyzer?.captureRequested = value
            // Capture cancellation/retry invalidates an in-flight embedding without
            // invalidating an asynchronous camera-provider binding request.
            analysisGeneration++
            analyzer?.sessionVersion = analysisGeneration
        }

    // ── Camera Lifecycle ─────────────────────────────────────

    private fun startCamera() {
        if (!isAttachedToWindow || disposed || !isActive) return
        val reactContext = context as? ReactContext ?: return
        val lifecycleOwner = reactContext.currentActivity as? LifecycleOwner
        if (lifecycleOwner == null) {
            emitResult(mapOf("status" to "ERROR", "reason" to "Camera activity is unavailable."))
            return
        }
        val requestGeneration = ++generation
        val requestSession = ++analysisGeneration
        val executor = cameraExecutor ?: Executors.newSingleThreadExecutor().also { cameraExecutor = it }
        val currentAnalyzer = analyzer ?: FaceAuthAnalyzer(context) { result, session ->
            post {
                if (session == analysisGeneration && isActive && isAttachedToWindow && !disposed) emitResult(result)
            }
        }.also { analyzer = it }
        currentAnalyzer.mode = currentMode
        currentAnalyzer.captureRequested = currentCaptureRequested
        currentAnalyzer.sessionVersion = requestSession
        currentAnalyzer.isActive = true

        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        cameraProviderFuture.addListener({
            if (requestGeneration != generation || !isActive || !isAttachedToWindow || disposed) return@addListener
            try {
                val provider = cameraProviderFuture.get()
                cameraProvider = provider

                // Preview use-case (what the user sees)
                val preview = Preview.Builder()
                    .setTargetResolution(Size(720, 1280))
                    .build()
                    .also { it.setSurfaceProvider(previewView.surfaceProvider) }

                // Analysis use-case (what the ML pipeline sees)
                val imageAnalysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .setTargetResolution(Size(720, 1280))
                    .build()
                    .also { it.setAnalyzer(executor, currentAnalyzer) }

                val cameraSelector = CameraSelector.DEFAULT_FRONT_CAMERA
                check(provider.hasCamera(cameraSelector)) { "This device has no front camera." }
                boundUseCases = arrayOf(preview, imageAnalysis)
                provider.bindToLifecycle(
                    lifecycleOwner, cameraSelector, preview, imageAnalysis
                )
                this.imageAnalysis = imageAnalysis
                val observer = Observer<PreviewView.StreamState> { state ->
                    if (state == PreviewView.StreamState.STREAMING && requestGeneration == generation && isActive) {
                        android.util.Log.d("FaceAuth", "CAMERAX_PREVIEW_STREAMING")
                    }
                }
                previewObserver = observer
                previewView.previewStreamState.observe(lifecycleOwner, observer)

                android.util.Log.d("FaceAuth", "CameraX started successfully (720p front)")
            } catch (t: Throwable) {
                android.util.Log.e("FaceAuth", "CameraX start failed: ${t.message}", t)
                stopCamera()
                emitResult(mapOf("status" to "ERROR", "reason" to "Unable to start the front camera. Please try again."))
            }
        }, ContextCompat.getMainExecutor(context))
    }

    private fun stopCamera() {
        generation++
        analysisGeneration++
        analyzer?.isActive = false
        imageAnalysis?.clearAnalyzer()
        previewObserver?.let { previewView.previewStreamState.removeObserver(it) }
        previewObserver = null
        if (boundUseCases.isNotEmpty()) cameraProvider?.unbind(*boundUseCases)
        boundUseCases = emptyArray()
        imageAnalysis = null
        android.util.Log.d("FaceAuth", "CameraX stopped")
    }

    // ── Event Emission ───────────────────────────────────────

    private fun emitResult(result: Map<String, Any?>) {
        val reactContext = context as? ReactContext ?: return
        val event = mapToWritableMap(result)
        reactContext.getJSModule(RCTEventEmitter::class.java)
            .receiveEvent(id, "onFaceAuthResult", event)
    }

    /**
     * Recursively converts a Kotlin Map<String, Any?> to a React Native WritableMap.
     * Handles String, Boolean, Int, Float, Double, Long, List, nested Map, and null.
     */
    private fun mapToWritableMap(map: Map<String, Any?>): WritableMap {
        val writableMap = Arguments.createMap()
        for ((key, value) in map) {
            when (value) {
                null -> writableMap.putNull(key)
                is String -> writableMap.putString(key, value)
                is Boolean -> writableMap.putBoolean(key, value)
                is Int -> writableMap.putInt(key, value)
                is Double -> writableMap.putDouble(key, value)
                is Float -> writableMap.putDouble(key, value.toDouble())
                is Long -> writableMap.putDouble(key, value.toDouble())
                is List<*> -> {
                    val array = Arguments.createArray()
                    for (item in value) {
                        when (item) {
                            is Double -> array.pushDouble(item)
                            is Float -> array.pushDouble(item.toDouble())
                            is Int -> array.pushInt(item)
                            is String -> array.pushString(item)
                            is Boolean -> array.pushBoolean(item)
                            else -> {}
                        }
                    }
                    writableMap.putArray(key, array)
                }
                is Map<*, *> -> {
                    @Suppress("UNCHECKED_CAST")
                    writableMap.putMap(key, mapToWritableMap(value as Map<String, Any?>))
                }
                else -> writableMap.putString(key, value.toString())
            }
        }
        return writableMap
    }

    // ── Cleanup ──────────────────────────────────────────────

    override fun onDetachedFromWindow() {
        stopCamera()
        releaseAnalyzer()
        super.onDetachedFromWindow()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (isActive) startCamera()
    }

    fun dispose() {
        disposed = true
        stopCamera()
        releaseAnalyzer()
    }

    private fun releaseAnalyzer() {
        val closingAnalyzer = analyzer
        val closingExecutor = cameraExecutor
        analyzer = null
        cameraExecutor = null
        // Close on the same serial executor, after any in-flight inference returns.
        if (closingExecutor != null) {
            closingExecutor.execute { closingAnalyzer?.close() }
            closingExecutor.shutdown()
        }
    }
}
