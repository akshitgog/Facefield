package com.datalakeauth.plugin

import android.graphics.Bitmap
import com.datalakeauth.models.ActiveLivenessEngine.LandmarkPoint
import com.datalakeauth.preprocessing.ImageCropUtils
import com.datalakeauth.preprocessing.ImageCropUtils.FaceBox
import com.mrousavy.camera.frameprocessor.Frame
import com.mrousavy.camera.frameprocessor.FrameProcessorPlugin
import com.mrousavy.camera.frameprocessor.VisionCameraProxy
import com.datalakeauth.utils.YuvToRgbConverter
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facedetector.FaceDetector
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import com.datalakeauth.models.ActiveLivenessEngine

/**
 * React Native Vision Camera Frame Processor Plugin.
 *
 * This is the bridge between the React Native camera and the Kotlin AI pipeline.
 * It is registered as "faceAuth" and called from JS like:
 *
 *   const result = faceAuth(frame);
 *
 * The plugin:
 *   1. Converts the Vision Camera Frame to an Android Bitmap
 *   2. Runs MediaPipe Face Detection to get the bounding box
 *   3. Runs MediaPipe FaceMesh to get 468 landmarks
 *   4. Passes everything to FaceAuthOrchestrator.verifyAttendance()
 *   5. Returns the result map back to React Native JS
 *
 * The SVG face guide oval drawn on the UI layer does NOT affect
 * the raw frame data — the model receives clean, unmodified pixels.
 */
class FaceAuthFrameProcessorPlugin(
    proxy: VisionCameraProxy,
    options: Map<String, Any>?
) : FrameProcessorPlugin() {

    private val context = proxy.context
    private val orchestrator: FaceAuthOrchestrator by lazy {
        FaceAuthOrchestrator(context)
    }
    private val faceDetector: FaceDetector? by lazy {
        try {
            val baseOptions = BaseOptions.builder().setModelAssetPath("face_detection_short_range.tflite").build()
            val options = FaceDetector.FaceDetectorOptions.builder()
                .setBaseOptions(baseOptions)
                .setRunningMode(RunningMode.IMAGE)
                .build()
            FaceDetector.createFromOptions(context, options)
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    private val faceLandmarker: FaceLandmarker? by lazy {
        try {
            val baseOptions = BaseOptions.builder().setModelAssetPath("face_landmarker.task").build()
            val options = FaceLandmarker.FaceLandmarkerOptions.builder()
                .setBaseOptions(baseOptions)
                .setRunningMode(RunningMode.IMAGE)
                .build()
            FaceLandmarker.createFromOptions(context, options)
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    private val dbHelper by lazy { EmbeddingDatabaseHelper(context) }
    private var missingFaceCount = 0

    /**
     * Called by react-native-vision-camera for every frame.
     *
     * This runs on the Camera Thread (NOT the JS thread),
     * so it will never block the UI or cause stuttering.
     *
     * @param frame  The raw camera frame from Vision Camera
     * @param params Optional parameters from JS (e.g., mode: "attendance" or "registration")
     * @return       A Map that React Native receives as a JS object
     */
    override fun callback(frame: Frame, params: Map<String, Any>?): Any? {
        val mode = params?.get("mode") as? String ?: "attendance"
        android.util.Log.d("FaceAuth", "FRAME_RECEIVED mode=$mode")

        // Handle direct SQLite operations triggered from JS (outside the camera loop)
        if (mode == "save_embedding") {
            val userId = params?.get("userId") as? String ?: return mapOf("error" to "Missing userId")
            val embeddingList = params["embedding"] as? List<*> ?: return mapOf("error" to "Missing embedding")
            
            val floatArray = FloatArray(embeddingList.size)
            for (i in embeddingList.indices) {
                floatArray[i] = (embeddingList[i] as Number).toFloat()
            }
            dbHelper.saveEmbedding(userId, floatArray)
            return mapOf("status" to "SUCCESS")
        }

        // ----------------------------------------------------------
        // 1. Convert Vision Camera Frame → Android Bitmap
        // ----------------------------------------------------------
        val bitmap: Bitmap = frameToBitmap(frame) ?: return mapOf(
            "status" to "RETRY",
            "reason" to "Failed to convert camera frame."
        )
        android.util.Log.d("FaceAuth", "BITMAP_OK ${bitmap.width}x${bitmap.height}")

        // ----------------------------------------------------------
        // 2. Run MediaPipe Face Detection → FaceBox
        // ----------------------------------------------------------
        val faceBox: FaceBox? = detectFace(bitmap)
        android.util.Log.d("FaceAuth", "FACE_DETECTED x=${faceBox?.x} y=${faceBox?.y} w=${faceBox?.width} h=${faceBox?.height}")

        if (faceBox == null) {
            missingFaceCount++
            if (missingFaceCount > 3) {
                orchestrator.resetSession()
            }
            return mapOf(
                "status" to "RETRY",
                "reason" to "No face detected.",
                "faceDetected" to false
            )
        }
        
        // Face found, reset the counter
        missingFaceCount = 0

        // ----------------------------------------------------------
        // 3. Run MediaPipe FaceMesh → 468 Landmarks
        // ----------------------------------------------------------
        val landmarks: List<LandmarkPoint>? = extractLandmarks(bitmap)
        android.util.Log.d("FaceAuth", "LANDMARKS=${landmarks?.size ?: 0}")

        if (landmarks == null || landmarks.size < 468) {
            return mapOf(
                "status" to "RETRY",
                "reason" to "FaceMesh landmarks not available.",
                "faceDetected" to true
            )
        }

        // ----------------------------------------------------------
        // 4. Quality Checks (Lighting, Sharpness, Rotation)
        //    BUG FIX: Evaluate on FACE CROP, not full camera frame!
        //    The full frame has dark background that drags brightness down.
        // ----------------------------------------------------------
        val faceCropForQuality = ImageCropUtils.getAlignedFaceCrop(bitmap, faceBox, 112, 112)
        val qualityResult = com.datalakeauth.preprocessing.FaceQualityChecker.evaluate(faceCropForQuality)
        val eyesVisible = landmarks.isNotEmpty() 
        
        // Calculate Roll (tilt) to prevent upside down / sideways
        // Eye 33 (left) and 263 (right)
        val leftEye = landmarks[33]
        val rightEye = landmarks[263]
        val dY = (rightEye.y - leftEye.y).toDouble()
        val dX = (rightEye.x - leftEye.x).toDouble()
        val rollAngle = Math.toDegrees(kotlin.math.atan2(dY, dX))
        val isStraight = kotlin.math.abs(rollAngle) < 30.0

        // brightnessAvg is 0.0-1.0 percentage, convert to 0-255 scale
        val brightness255 = qualityResult.brightnessAvg * 255f

        android.util.Log.d("FaceAuth", "QUALITY_DEBUG brightness255=$brightness255 sharpness=${qualityResult.sharpnessScore} roll=$rollAngle straight=$isStraight eyes=$eyesVisible mode=$mode")

        if (mode == "registration") {
            // REGISTRATION REQUIREMENTS:
            // - Face Centered (center point in middle 50% of screen)
            // - Eyes Visible
            // - Sharpness > 5
            // - Brightness: 50 to 200
            // - Face Straight (Roll < 30)
            val faceCenterX = faceBox.x + (faceBox.width / 2f)
            val faceCenterY = faceBox.y + (faceBox.height / 2f)
            val isCentered = faceCenterX > bitmap.width * 0.25f && faceCenterX < bitmap.width * 0.75f &&
                             faceCenterY > bitmap.height * 0.25f && faceCenterY < bitmap.height * 0.75f
                             
            val brightnessOk = brightness255 in 50f..200f
            val sharpnessOk = qualityResult.sharpnessScore > 5.0f
            val qualityPassed = brightnessOk && sharpnessOk && eyesVisible && isCentered && isStraight

            android.util.Log.d("FaceAuth", "REG_QUALITY pass=$qualityPassed bright=$brightnessOk(val=$brightness255) sharp=$sharpnessOk(val=${qualityResult.sharpnessScore}) center=$isCentered(cx=$faceCenterX cy=$faceCenterY imgW=${bitmap.width} imgH=${bitmap.height}) straight=$isStraight(roll=$rollAngle)")

            // Active Liveness (Blink, Smile, Turn Head)
            val liveness = ActiveLivenessEngine.evaluate(
                landmarks = landmarks,
                faceBoxX = faceBox.x,
                faceBoxY = faceBox.y,
                faceBoxW = faceBox.width,
                faceBoxH = faceBox.height
            )

            // For Registration, we require good quality.
            if (!qualityPassed) {
                return mapOf(
                    "status" to "RETRY",
                    "reason" to "", // Silent wait, no annoying popup messages
                    "faceDetected" to true,
                    "qualityPassed" to qualityPassed,
                    "lightingGood" to brightnessOk,
                    "eyesVisible" to eyesVisible,
                    "blinkDetected" to liveness.blinkDetected,
                    "smileDetected" to liveness.smileDetected,
                    "headTurnDetected" to liveness.headTurnDetected
                )
            }

            // If quality passes:
            val embedding = orchestrator.extractRegistrationEmbedding(bitmap, faceBox)
            
            // Crop face to 400x400 with a wider margin (1.8x) for high-quality UI preview
            val displayCrop = ImageCropUtils.getDisplayFaceCrop(bitmap, faceBox, 400, 400)
            
            val byteArrayOutputStream = java.io.ByteArrayOutputStream()
            displayCrop.compress(Bitmap.CompressFormat.JPEG, 90, byteArrayOutputStream)
            val faceBase64 = android.util.Base64.encodeToString(
                byteArrayOutputStream.toByteArray(), 
                android.util.Base64.NO_WRAP
            )

            return mapOf(
                "status" to "EMBEDDING",
                "embedding" to embedding.map { it.toDouble() },
                "faceBase64" to faceBase64,
                "faceDetected" to true,
                "qualityPassed" to true,
                "lightingGood" to true,
                "eyesVisible" to true
            )
        }

        // ----------------------------------------------------------
        // 4. Attendance Mode (Recognition)
        // ----------------------------------------------------------
        // RECOGNITION REQUIREMENTS:
        // - NO face centered requirement
        // - Liveness (Blink, Smile, Turn) — checked inside orchestrator
        // - Brightness: 50 to 200
        // - Sharpness > 5
        // - Face Straight (Roll < 30)
        
        val brightnessOk = brightness255 in 50f..200f
        val sharpnessOk = qualityResult.sharpnessScore > 5.0f
        val qualityPassed = brightnessOk && sharpnessOk && isStraight

        android.util.Log.d("FaceAuth", "ATT_QUALITY pass=$qualityPassed bright=$brightnessOk(val=$brightness255) sharp=$sharpnessOk(val=${qualityResult.sharpnessScore}) straight=$isStraight(roll=$rollAngle)")
        
        // PULL DIRECTLY FROM NATIVE SQLITE (Lightning fast!)
        val storedEmbeddings = dbHelper.getAllEmbeddings()
        
        val qualityReason = if (!brightnessOk) "Too dark or too bright. Adjust lighting."
                            else if (!sharpnessOk) "Hold still to focus."
                            else if (!isStraight) "Look straight at the camera."
                            else ""

        return orchestrator.verifyAttendance(
            bitmap = bitmap,
            faceBox = faceBox,
            faceMeshLandmarks = landmarks,
            storedEmbeddings = storedEmbeddings,
            qualityPassed = qualityPassed,
            qualityReason = qualityReason
        )
    }

    private fun frameToBitmap(frame: Frame): Bitmap? {
        return try {
            val image = frame.getImage() ?: return null
            val rawBmp = YuvToRgbConverter.imageToBitmap(image) ?: return null
            
            val matrix = android.graphics.Matrix()
            
            // Camera sensors are natively landscape. 
            // If the raw buffer is landscape, we must rotate it to match the phone's Portrait UI.
            if (rawBmp.width > rawBmp.height) {
                // Front cameras usually need 270 degrees, back cameras 90 degrees
                val sensorRotation = if (frame.isMirrored) 270f else 90f
                matrix.postRotate(sensorRotation)
            }
            
            // Mirroring the image if it's a front camera
            if (frame.isMirrored) {
                matrix.postScale(-1f, 1f)
            }
            
            Bitmap.createBitmap(rawBmp, 0, 0, rawBmp.width, rawBmp.height, matrix, true)
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Runs MediaPipe Face Detection on the bitmap.
     * Returns the largest/most-centered face bounding box.
     */
    private fun detectFace(bitmap: Bitmap): FaceBox? {
        val mpImage = BitmapImageBuilder(bitmap).build()
        val result = faceDetector?.detect(mpImage) ?: return null
        if (result.detections().isEmpty()) return null
        
        // Take the first detected face
        val detection = result.detections()[0]
        val bbox = detection.boundingBox()
        val conf = detection.categories()[0].score()
        return FaceBox(
            x = bbox.left,
            y = bbox.top,
            width = bbox.width(),
            height = bbox.height(),
            confidence = conf
        )
    }

    /**
     * Runs MediaPipe FaceMesh / FaceLandmarker on the bitmap.
     * Returns 468 landmark points in pixel coordinates.
     */
    private fun extractLandmarks(bitmap: Bitmap): List<LandmarkPoint>? {
        val mpImage = BitmapImageBuilder(bitmap).build()
        val result = faceLandmarker?.detect(mpImage) ?: return null
        if (result.faceLandmarks().isEmpty()) return null
        
        val landmarks = result.faceLandmarks()[0]
        val width = bitmap.width.toFloat()
        val height = bitmap.height.toFloat()
        
        return landmarks.map { 
            LandmarkPoint(it.x() * width, it.y() * height)
        }
    }
}
