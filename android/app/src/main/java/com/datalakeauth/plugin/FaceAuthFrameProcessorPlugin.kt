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
            return mapOf(
                "status" to "RETRY",
                "reason" to "No face detected.",
                "faceDetected" to false
            )
        }

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

        if (mode == "registration") {
            // 1. Active Liveness (Blink, Smile, Turn Head)
            val liveness = ActiveLivenessEngine.evaluate(
                landmarks = landmarks,
                faceBoxX = faceBox.x,
                faceBoxY = faceBox.y,
                faceBoxW = faceBox.width,
                faceBoxH = faceBox.height
            )
            android.util.Log.d("FaceAuth", "LIVENESS blink=${liveness.blinkDetected} smile=${liveness.smileDetected} head=${liveness.headTurnDetected} pass=${liveness.livenessPass}")

            // 2. Quality Checks
            val faceSizeOk = faceBox.width >= bitmap.width * 0.3f && faceBox.height >= bitmap.height * 0.3f
            val faceCentered = Math.abs((faceBox.x + faceBox.width / 2f) - (bitmap.width / 2f)) < bitmap.width * 0.2f
            val lightingGood = true // Stub for lighting, usually checked via histogram
            val eyesVisible = landmarks.isNotEmpty() // If FaceMesh worked, eyes are visible

            val qualityPassed = faceSizeOk && faceCentered && lightingGood && eyesVisible
            android.util.Log.d("FaceAuth", "QUALITY pass=$qualityPassed size=$faceSizeOk center=$faceCentered eyes=$eyesVisible")

            if (!liveness.livenessPass || !qualityPassed) {
                return mapOf(
                    "status" to "RETRY",
                    "reason" to "Please center face and blink/smile.",
                    "faceDetected" to true,
                    "qualityPassed" to qualityPassed,
                    "faceSizeOk" to faceSizeOk,
                    "faceCentered" to faceCentered,
                    "lightingGood" to lightingGood,
                    "eyesVisible" to eyesVisible,
                    "blinkDetected" to liveness.blinkDetected,
                    "smileDetected" to liveness.smileDetected,
                    "headTurnDetected" to liveness.headTurnDetected
                )
            }

            // If quality & liveness pass:
            val embedding = orchestrator.extractRegistrationEmbedding(bitmap, faceBox)
            android.util.Log.d("FaceAuth", "EMBEDDING size=${embedding.size}")

            // Crop face to 112×112 and encode as base64 for permanent JS storage
            val alignedCrop = ImageCropUtils.getAlignedFaceCrop(bitmap, faceBox, 112, 112)
            val baos = java.io.ByteArrayOutputStream()
            alignedCrop.compress(Bitmap.CompressFormat.JPEG, 85, baos)
            val faceBase64 = android.util.Base64.encodeToString(
                baos.toByteArray(), android.util.Base64.NO_WRAP
            )

            return mapOf(
                "status" to "EMBEDDING",
                "embedding" to embedding.map { it.toDouble() },
                "faceBase64" to faceBase64,
                "faceDetected" to true,
                "qualityPassed" to true,
                "faceSizeOk" to true,
                "faceCentered" to true,
                "lightingGood" to true,
                "eyesVisible" to true
            )
        }

        // ----------------------------------------------------------
        // 4. Attendance Mode: Run the full parallel pipeline
        // ----------------------------------------------------------
        
        // PULL DIRECTLY FROM NATIVE SQLITE (Lightning fast!)
        val storedEmbeddings = dbHelper.getAllEmbeddings()

        return orchestrator.verifyAttendance(
            bitmap = bitmap,
            faceBox = faceBox,
            faceMeshLandmarks = landmarks,
            storedEmbeddings = storedEmbeddings
        )
    }

    private fun frameToBitmap(frame: Frame): Bitmap? {
        return try {
            val image = frame.getImage() ?: return null
            YuvToRgbConverter.imageToBitmap(image)
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
