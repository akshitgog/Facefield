package com.datalakeauth.plugin

import android.content.Context
import android.graphics.Bitmap
import com.datalakeauth.models.ActiveLivenessEngine
import com.datalakeauth.models.ActiveLivenessEngine.LandmarkPoint
import com.datalakeauth.models.FaceNetEngine
import com.datalakeauth.models.SilentFaceEngine
import com.datalakeauth.preprocessing.ImageCropUtils.FaceBox
import com.datalakeauth.registration.RegistrationEngine
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking

/**
 * The main orchestrator for the face authentication pipeline.
 *
 * Pipeline order (parallel where possible):
 *
 *   1. Face Detection + FaceMesh landmarks (done by caller / MediaPipe)
 *   2. IN PARALLEL:
 *      a. Active Liveness (pure landmark math — microseconds)
 *      b. Passive Liveness / SilentFace (TFLite inference — milliseconds)
 *   3. If BOTH pass → MobileFaceNet Recognition
 *   4. Cosine Similarity → ACCEPT / REJECT
 *
 * Active Liveness runs passively in the background. The user sees a
 * simple note: "Please blink, smile, or turn your head slightly."
 * The system checks blink OR smile OR head_turn simultaneously.
 * There are NO sequential prompts and NO waiting.
 */
class FaceAuthOrchestrator(context: Context) {

    private val silentFaceEngine = SilentFaceEngine(context)
    private val faceNetEngine = FaceNetEngine(context)
    private val registrationEngine = RegistrationEngine(context)

    /**
     * Runs the full attendance verification pipeline with parallel liveness.
     *
     * @param bitmap              The full camera frame as a Bitmap
     * @param faceBox             The detected face bounding box
     * @param faceMeshLandmarks   The 468 MediaPipe FaceMesh landmarks (pixel coords)
     * @param storedEmbeddings    The user's stored embeddings from SQLite
     * @param similarityThreshold Cosine similarity threshold for match (default 0.4)
     *
     * @return A Map<String, Any?> serialized to JSON for React Native
     */
    fun verifyAttendance(
        bitmap: Bitmap,
        faceBox: FaceBox,
        faceMeshLandmarks: List<LandmarkPoint>,
        storedEmbeddings: Map<String, FloatArray>,
        similarityThreshold: Float = 0.4f
    ): Map<String, Any?> {

        // ============================================================
        // STEP 1 & 2: Run Active Liveness + SilentFace IN PARALLEL
        //
        // Active Liveness = pure math on landmarks (microseconds)
        // SilentFace = TFLite model inference (milliseconds)
        // Both use the same frame and face box, no dependency.
        // ============================================================
        val (liveness, spoofResult) = runBlocking {
            val livenessDeferred = async {
                ActiveLivenessEngine.evaluate(
                    landmarks = faceMeshLandmarks,
                    faceBoxX = faceBox.x,
                    faceBoxY = faceBox.y,
                    faceBoxW = faceBox.width,
                    faceBoxH = faceBox.height
                )
            }
            val spoofDeferred = async {
                silentFaceEngine.verify(bitmap, faceBox)
            }
            Pair(livenessDeferred.await(), spoofDeferred.await())
        }

        // ---------- Evaluate parallel results ----------

        // Spoof detected → REJECT immediately
        if (!spoofResult.isLive) {
            return buildResult(
                status = "REJECT",
                reason = "Spoof detected. This does not appear to be a live face.",
                isLive = false,
                liveScore = spoofResult.liveScore,
                spoofScore = spoofResult.spoofScore,
                qualityPassed = false,
                liveness = liveness
            )
        }

        // Active liveness not yet triggered → RETRY (user hasn't blinked/smiled/turned)
        if (!liveness.livenessPass) {
            return buildResult(
                status = "RETRY",
                reason = "Please blink, smile, or turn your head slightly.",
                isLive = true,
                liveScore = spoofResult.liveScore,
                spoofScore = spoofResult.spoofScore,
                qualityPassed = false,
                liveness = liveness
            )
        }

        // ============================================================
        // STEP 3: Face Recognition (MobileFaceNet)
        // Runs ONLY after both liveness checks pass.
        // ============================================================
        val embedding = faceNetEngine.extractEmbedding(bitmap, faceBox)
        val matchResult = faceNetEngine.match(embedding, storedEmbeddings, similarityThreshold)

        if (!matchResult.matched) {
            return buildResult(
                status = "REJECT",
                reason = "Face not recognized. No matching user found.",
                isLive = true,
                liveScore = spoofResult.liveScore,
                spoofScore = spoofResult.spoofScore,
                qualityPassed = true,
                liveness = liveness,
                matchedUserId = null,
                recognitionScore = matchResult.recognitionScore
            )
        }

        // ============================================================
        // STEP 4: SUCCESS — All checks passed
        // ============================================================
        return buildResult(
            status = "ACCEPT",
            reason = "Attendance verified successfully.",
            isLive = true,
            liveScore = spoofResult.liveScore,
            spoofScore = spoofResult.spoofScore,
            qualityPassed = true,
            liveness = liveness,
            matchedUserId = matchResult.matchedUserId,
            recognitionScore = matchResult.recognitionScore
        )
    }

    /**
     * Registration mode: extracts a robust face embedding for enrollment
     * using the RegistrationEngine (5 variants averaged and normalized).
     */
    fun extractRegistrationEmbedding(bitmap: Bitmap, faceBox: FaceBox): FloatArray {
        return registrationEngine.generateRobustEmbedding(bitmap, faceBox)
    }

    fun close() {
        silentFaceEngine.close()
        faceNetEngine.close()
        registrationEngine.close()
    }

    /**
     * Builds a consistent result map matching the VerifyFaceOutput contract
     * from master.md (lines 582-593).
     */
    private fun buildResult(
        status: String,
        reason: String,
        isLive: Boolean,
        liveScore: Float,
        spoofScore: Float,
        qualityPassed: Boolean,
        liveness: ActiveLivenessEngine.LivenessResult,
        matchedUserId: String? = null,
        recognitionScore: Float? = null
    ): Map<String, Any?> {
        return mapOf(
            "status" to status,
            "decision" to status,
            "reason" to reason,
            "faceDetected" to true,
            "isLive" to isLive,
            "liveScore" to liveScore.toDouble(),
            "spoofScore" to spoofScore.toDouble(),
            "qualityPassed" to qualityPassed,
            "blinkDetected" to liveness.blinkDetected,
            "smileDetected" to liveness.smileDetected,
            "headTurnDetected" to liveness.headTurnDetected,
            "matchedUserId" to matchedUserId,
            "recognitionScore" to recognitionScore?.toDouble()
        )
    }
}
