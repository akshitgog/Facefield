package com.datalakeauth.camerax

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.SystemClock
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.datalakeauth.models.ActiveLivenessEngine
import com.datalakeauth.models.ActiveLivenessEngine.LandmarkPoint
import com.datalakeauth.plugin.EmbeddingDatabaseHelper
import com.datalakeauth.plugin.FaceAuthOrchestrator
import com.datalakeauth.preprocessing.FaceQualityChecker
import com.datalakeauth.preprocessing.ImageCropUtils
import com.datalakeauth.preprocessing.ImageCropUtils.FaceBox
import com.datalakeauth.registration.EnrollmentLivenessGate
import com.datalakeauth.utils.YuvToRgbConverter
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facedetector.FaceDetector
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker

/**
 * CameraX ImageAnalysis.Analyzer — replaces VisionCamera's FrameProcessorPlugin.
 *
 * Receives ImageProxy frames from CameraX, runs the full face-auth pipeline
 * (MediaPipe detection → landmarks → quality → orchestrator), and emits results
 * back to React Native via a callback.
 *
 * Key improvements over VisionCamera:
 *  - CameraX STRATEGY_KEEP_ONLY_LATEST automatically drops frames when the
 *    analyzer is still processing the previous one → zero buffer queue overflow.
 *  - No JSI / Worklet thread-hopping → no silent crash surface.
 *  - Guaranteed imageProxy.close() via try/finally → no native memory leaks.
 */
class FaceAuthAnalyzer(
    private val context: Context,
    private val onResult: (Map<String, Any?>, Long) -> Unit
) : ImageAnalysis.Analyzer {

    @Volatile var mode: String = "attendance"
    @Volatile var captureRequested: Boolean = false
    @Volatile var isActive: Boolean = false
    @Volatile var sessionVersion: Long = 0L
    private var frameSession = -1L
    private var lastAnalysisAt = 0L
    private var captureConsumed = false
    private var previousCaptureRequested = false
    private val enrollmentLiveness = EnrollmentLivenessGate()

    private val orchestratorDelegate = lazy { FaceAuthOrchestrator(context) }
    private val orchestrator: FaceAuthOrchestrator by orchestratorDelegate
    private val dbHelper by lazy { EmbeddingDatabaseHelper.getInstance(context) }

    private val faceDetectorDelegate = lazy {
        try {
            val baseOptions = BaseOptions.builder()
                .setModelAssetPath("face_detection_short_range.tflite").build()
            val options = FaceDetector.FaceDetectorOptions.builder()
                .setBaseOptions(baseOptions)
                .setRunningMode(RunningMode.IMAGE)
                .build()
            FaceDetector.createFromOptions(context, options)
        } catch (t: Throwable) {
            android.util.Log.e("FaceAuth", "Failed to init FaceDetector: ${t.message}", t)
            null
        }
    }
    private val faceDetector: FaceDetector? by faceDetectorDelegate

    private val faceLandmarkerDelegate = lazy {
        try {
            val baseOptions = BaseOptions.builder()
                .setModelAssetPath("face_landmarker.task").build()
            val options = FaceLandmarker.FaceLandmarkerOptions.builder()
                .setBaseOptions(baseOptions)
                .setRunningMode(RunningMode.IMAGE)
                .build()
            FaceLandmarker.createFromOptions(context, options)
        } catch (t: Throwable) {
            android.util.Log.e("FaceAuth", "Failed to init FaceLandmarker: ${t.message}", t)
            null
        }
    }
    private val faceLandmarker: FaceLandmarker? by faceLandmarkerDelegate

    private var missingFaceCount = 0

    // ────────────────────────────────────────────────────────────
    // Entry point — called by CameraX on the analysis executor
    // ────────────────────────────────────────────────────────────
    override fun analyze(imageProxy: ImageProxy) {
        if (!isActive) {
            imageProxy.close()
            return
        }

        try {
            val now = SystemClock.elapsedRealtime()
            if (sessionVersion != frameSession) {
                frameSession = sessionVersion
                resetRegistration()
                if (orchestratorDelegate.isInitialized()) orchestrator.resetSession()
                missingFaceCount = 0
                lastAnalysisAt = 0L
            }
            val interval = if (mode == "registration" && !captureRequested) 250L else 100L
            if (now - lastAnalysisAt < interval) return
            lastAnalysisAt = now
            if (mode == "registration") {
                if (captureRequested != previousCaptureRequested) {
                    resetRegistration()
                    previousCaptureRequested = captureRequested
                }
                if (captureConsumed && captureRequested) return
            }
            val bitmap = imageProxyToBitmap(imageProxy)
            if (bitmap == null) {
                emitResult(mapOf(
                    "status" to "ERROR",
                    "reason" to "Failed to convert camera frame."
                ))
                return
            }

            try {
                // MPImage owns and recycles this bitmap on close. Keep it alive through
                // detection, landmarks, quality, anti-spoof and embedding extraction.
                BitmapImageBuilder(bitmap).build().use { processFrame(bitmap, it) }
            } finally {
                if (!bitmap.isRecycled) bitmap.recycle()
            }
        } catch (t: Throwable) {
            android.util.Log.e("FaceAuth", "Analyzer error: ${t.message}", t)
            emitResult(mapOf("status" to "ERROR", "reason" to "Face analysis failed. Please try again."))
        } finally {
            imageProxy.close()
        }
    }

    // ────────────────────────────────────────────────────────────
    // ImageProxy → Bitmap conversion (replaces VisionCamera frameToBitmap)
    // ────────────────────────────────────────────────────────────
    @androidx.annotation.OptIn(markerClass = [ExperimentalGetImage::class])
    private fun imageProxyToBitmap(imageProxy: ImageProxy): Bitmap? {
        return try {
            val image = imageProxy.image ?: return null
            val rawBmp = YuvToRgbConverter.imageToBitmap(image) ?: return null

            val matrix = Matrix()

            // CameraX provides the exact rotation needed
            val rotation = imageProxy.imageInfo.rotationDegrees.toFloat()
            if (rotation != 0f) {
                matrix.postRotate(rotation)
            }

            // Mirror for front camera (CameraX analysis frames are NOT mirrored)
            matrix.postScale(-1f, 1f)

            val result = Bitmap.createBitmap(
                rawBmp, 0, 0, rawBmp.width, rawBmp.height, matrix, true
            )
            if (result !== rawBmp) {
                rawBmp.recycle()
            }
            result
        } catch (t: Throwable) {
            android.util.Log.e("FaceAuth", "imageProxyToBitmap error: ${t.message}", t)
            null
        }
    }

    // ────────────────────────────────────────────────────────────
    // Main processing pipeline (ported from FaceAuthFrameProcessorPlugin)
    // ────────────────────────────────────────────────────────────
    private fun processFrame(bitmap: Bitmap, image: MPImage) {
        android.util.Log.d("FaceAuth", "FRAME_RECEIVED mode=$mode")

        // ── Step 1: Face Detection ──
        val faceBox = detectFace(image)
        android.util.Log.d("FaceAuth", "FACE_DETECTED x=${faceBox?.x} y=${faceBox?.y} w=${faceBox?.width} h=${faceBox?.height}")

        if (faceBox == null) {
            android.util.Log.d("FaceAuth", "QUALITY_FAIL: NO FACE DETECTED")
            missingFaceCount++
            if (missingFaceCount > 3) {
                if (orchestratorDelegate.isInitialized()) orchestrator.resetSession()
                resetRegistration()
            }
            emitResult(mapOf(
                "status" to "RETRY",
                "reason" to "No face detected.",
                "faceDetected" to false
            ))
            return
        }
        missingFaceCount = 0

        // ── Step 2: FaceMesh Landmarks ──
        val landmarks = extractLandmarks(bitmap, image)
        android.util.Log.d("FaceAuth", "LANDMARKS=${landmarks?.size ?: 0}")

        if (landmarks == null || landmarks.size < 468) {
            emitResult(mapOf(
                "status" to "RETRY",
                "reason" to "FaceMesh landmarks not available.",
                "faceDetected" to true
            ))
            return
        }
        android.util.Log.d("FaceAuth", "LANDMARKS_OK count=${landmarks.size}")

        // ── Step 3: Quality Checks ──
        val faceCropForQuality = ImageCropUtils.getAlignedFaceCrop(bitmap, faceBox, 112, 112)
        val qualityResult = try {
            FaceQualityChecker.evaluate(faceCropForQuality)
        } finally {
            faceCropForQuality.recycle()
        }
        val eyesVisible = landmarks.isNotEmpty()

        // Roll angle from eye landmarks
        val leftEye = landmarks[33]
        val rightEye = landmarks[263]
        val dY = (rightEye.y - leftEye.y).toDouble()
        val dX = (rightEye.x - leftEye.x).toDouble()
        val rollAngle = Math.toDegrees(kotlin.math.atan2(dY, dX))
        val absoluteRoll = kotlin.math.abs(rollAngle)
        val isStraight = minOf(absoluteRoll, 180.0 - absoluteRoll) < 30.0

        val brightness255 = qualityResult.brightnessAvg * 255f

        android.util.Log.d("FaceAuth", "QUALITY_DEBUG brightness255=$brightness255 sharpness=${qualityResult.sharpnessScore} roll=$rollAngle straight=$isStraight eyes=$eyesVisible mode=$mode")

        // ── Step 4: Mode-specific pipeline ──
        if (mode == "registration") {
            handleRegistration(bitmap, faceBox, landmarks, qualityResult, brightness255, eyesVisible, isStraight, rollAngle)
        } else {
            handleAttendance(bitmap, faceBox, landmarks, qualityResult, brightness255, isStraight)
        }
    }

    // ────────────────────────────────────────────────────────────
    // Registration Mode
    // ────────────────────────────────────────────────────────────
    private fun handleRegistration(
        bitmap: Bitmap, faceBox: FaceBox, landmarks: List<LandmarkPoint>,
        qualityResult: FaceQualityChecker.QualityResult, brightness255: Float,
        eyesVisible: Boolean, isStraight: Boolean, rollAngle: Double
    ) {
        android.util.Log.d("FaceAuth", "REGISTRATION_START")

        val faceCenterX = faceBox.x + (faceBox.width / 2f)
        val faceCenterY = faceBox.y + (faceBox.height / 2f)
        val isCentered = faceCenterX > bitmap.width * 0.25f && faceCenterX < bitmap.width * 0.75f &&
                         faceCenterY > bitmap.height * 0.25f && faceCenterY < bitmap.height * 0.75f

        val faceSizeOk = faceBox.width > bitmap.width * 0.35f

        val brightnessOk = brightness255 in 50f..200f
        val sharpnessOk = qualityResult.sharpnessScore > 5.0f
        val qualityPassed = brightnessOk && sharpnessOk && eyesVisible && isCentered && isStraight && faceSizeOk

        android.util.Log.d("FaceAuth", "REG_QUALITY pass=$qualityPassed size=$faceSizeOk bright=$brightnessOk(val=$brightness255) sharp=$sharpnessOk(val=${qualityResult.sharpnessScore}) center=$isCentered straight=$isStraight(roll=$rollAngle)")

        // Active Liveness (Blink, Smile, Turn Head)
        val liveness = ActiveLivenessEngine.evaluate(
            landmarks = landmarks,
            faceBoxX = faceBox.x, faceBoxY = faceBox.y,
            faceBoxW = faceBox.width, faceBoxH = faceBox.height
        )

        if (!qualityPassed) {
            if (captureRequested) enrollmentLiveness.reset()
            val regReason = when {
                !faceSizeOk -> "Move closer to the camera."
                !isCentered -> "Center your face in the oval."
                !isStraight -> "Look straight at the camera."
                !brightnessOk && brightness255 < 50f -> "Too dark. Move to better light."
                !brightnessOk && brightness255 > 200f -> "Too bright. Avoid harsh glare."
                !sharpnessOk -> "Hold still to focus."
                !eyesVisible -> "Looking for face..."
                else -> "Adjusting camera..."
            }
            emitResult(mapOf(
                "status" to "RETRY",
                "reason" to regReason,
                "faceDetected" to true,
                "qualityPassed" to false,
                "lightingGood" to brightnessOk,
                "eyesVisible" to eyesVisible,
                "blinkDetected" to liveness.blinkDetected,
                "smileDetected" to liveness.smileDetected,
                "headTurnDetected" to liveness.headTurnDetected
            ))
            return
        }

        android.util.Log.d("FaceAuth", "QUALITY_PASS")

        // Quality passed but capture NOT requested → preview-only indicator update
        if (!captureRequested) {
            emitResult(mapOf(
                "status" to "RETRY",
                "reason" to "Ready to capture. Tap the button.",
                "faceDetected" to true,
                "qualityPassed" to true,
                "lightingGood" to true,
                "eyesVisible" to true,
                "blinkDetected" to liveness.blinkDetected,
                "smileDetected" to liveness.smileDetected,
                "headTurnDetected" to liveness.headTurnDetected
            ))
            return
        }

        // Enrollment needs an observed open/closed/open blink plus passive anti-spoof.
        val spoof = orchestrator.verifyRegistrationLiveness(bitmap, faceBox)
        val decision = enrollmentLiveness.observe(liveness.blinkDetected, spoof.isLive, spoof.spoofScore)
        if (decision == EnrollmentLivenessGate.Decision.REJECT) {
            resetRegistration()
            emitResult(mapOf("status" to "REJECT", "reason" to "Spoof detected. Please use your live face.", "faceDetected" to true))
            return
        }
        if (decision == EnrollmentLivenessGate.Decision.PENDING) {
            emitResult(mapOf(
                "status" to "RETRY", "reason" to "Please blink, then hold still to register.",
                "faceDetected" to true, "qualityPassed" to true,
                "blinkDetected" to enrollmentLiveness.blinkPassed
            ))
            return
        }
        captureConsumed = true
        // ── Capture requested + quality and liveness pass → generate embedding ──
        android.util.Log.d("FaceAuth", "EMBEDDING_GENERATION_START")
        val embedding = orchestrator.extractRegistrationEmbedding(bitmap, faceBox)
        android.util.Log.d("FaceAuth", "EMBEDDING_GENERATION_END")

        // Crop face to 400×400 for UI preview
        val displayCrop = ImageCropUtils.getDisplayFaceCrop(bitmap, faceBox, 400, 400)
        val faceBase64 = try {
            val baos = java.io.ByteArrayOutputStream()
            displayCrop.compress(Bitmap.CompressFormat.JPEG, 90, baos)
            android.util.Base64.encodeToString(baos.toByteArray(), android.util.Base64.NO_WRAP)
        } finally {
            displayCrop.recycle()
        }

        emitResult(mapOf(
            "status" to "EMBEDDING",
            "reason" to "Face captured successfully.",
            "embedding" to embedding.map { it.toDouble() },
            "faceBase64" to faceBase64,
            "faceDetected" to true,
            "qualityPassed" to true,
            "lightingGood" to true,
            "eyesVisible" to true
        ))
    }

    // ────────────────────────────────────────────────────────────
    // Attendance Mode
    // ────────────────────────────────────────────────────────────
    private fun handleAttendance(
        bitmap: Bitmap, faceBox: FaceBox, landmarks: List<LandmarkPoint>,
        qualityResult: FaceQualityChecker.QualityResult, brightness255: Float,
        isStraight: Boolean
    ) {
        val faceSizeOk = faceBox.width > bitmap.width * 0.35f
        val brightnessOk = brightness255 in 50f..200f
        val sharpnessOk = qualityResult.sharpnessScore > 5.0f
        val qualityPassed = brightnessOk && sharpnessOk && isStraight && faceSizeOk

        android.util.Log.d("FaceAuth", "ATT_QUALITY pass=$qualityPassed size=$faceSizeOk bright=$brightnessOk(val=$brightness255) sharp=$sharpnessOk(val=${qualityResult.sharpnessScore}) straight=$isStraight")

        val storedEmbeddings = dbHelper.getAllEmbeddings()

        val qualityReason = when {
            !faceSizeOk -> "Move closer to the camera."
            !brightnessOk -> {
                val lightStatus = if (brightness255 < 50f) "TOO DARK" else "TOO BRIGHT"
                android.util.Log.d("FaceAuth", "QUALITY_FAIL: $lightStatus (val=$brightness255)")
                "Too dark or too bright. Adjust lighting."
            }
            !sharpnessOk -> {
                android.util.Log.d("FaceAuth", "QUALITY_FAIL: BLURRY (val=${qualityResult.sharpnessScore})")
                "Hold still to focus."
            }
            !isStraight -> {
                android.util.Log.d("FaceAuth", "QUALITY_FAIL: TILTED HEAD")
                "Look straight at the camera."
            }
            else -> ""
        }

        val startTime = System.currentTimeMillis()
        val result = orchestrator.verifyAttendance(
            bitmap = bitmap,
            faceBox = faceBox,
            faceMeshLandmarks = landmarks,
            storedEmbeddings = storedEmbeddings,
            qualityPassed = qualityPassed,
            qualityReason = qualityReason
        )
        android.util.Log.d("FaceAuth", "PIPELINE_TIMING Orchestrator took ${System.currentTimeMillis() - startTime} ms")

        emitResult(result)
    }

    // ────────────────────────────────────────────────────────────
    // MediaPipe Helpers
    // ────────────────────────────────────────────────────────────
    private fun detectFace(image: MPImage): FaceBox? {
        return try {
            val detector = faceDetector ?: error("Face detector model could not be loaded")
            val result = detector.detect(image)
            if (result.detections().isEmpty()) return null

            val detection = result.detections()[0]
            val bbox = detection.boundingBox()
            val conf = detection.categories()[0].score()
            FaceBox(
                x = bbox.left, y = bbox.top,
                width = bbox.width(), height = bbox.height(),
                confidence = conf
            )
        } catch (t: Throwable) {
            android.util.Log.e("FaceAuth", "detectFace error: ${t.message}", t)
            throw t
        }
    }

    private fun extractLandmarks(bitmap: Bitmap, image: MPImage): List<LandmarkPoint>? {
        return try {
            val landmarker = faceLandmarker ?: error("Face landmark model could not be loaded")
            val result = landmarker.detect(image)
            if (result.faceLandmarks().isEmpty()) return null

            val landmarks = result.faceLandmarks()[0]
            val width = bitmap.width.toFloat()
            val height = bitmap.height.toFloat()
            landmarks.map { LandmarkPoint(it.x() * width, it.y() * height) }
        } catch (t: Throwable) {
            android.util.Log.e("FaceAuth", "extractLandmarks error: ${t.message}", t)
            throw t
        }
    }

    fun close() {
        isActive = false
        if (orchestratorDelegate.isInitialized()) orchestrator.close()
        if (faceDetectorDelegate.isInitialized()) faceDetector?.close()
        if (faceLandmarkerDelegate.isInitialized()) faceLandmarker?.close()
    }

    private fun emitResult(result: Map<String, Any?>) {
        if (isActive && frameSession == sessionVersion) {
            android.util.Log.d("FaceAuth", "ANALYSIS_RESULT status=${result["status"]}")
            onResult(if (result["status"] == "ERROR") result else result + ("frameProcessed" to true), frameSession)
        }
    }

    private fun resetRegistration() {
        captureConsumed = false
        enrollmentLiveness.reset()
    }
}
