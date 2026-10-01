package com.datalakeauth.plugin

import android.content.Context
import android.graphics.Bitmap
import com.datalakeauth.models.ActiveLivenessEngine
import com.datalakeauth.models.ActiveLivenessEngine.LandmarkPoint
import com.datalakeauth.models.FaceNetEngine
import com.datalakeauth.models.ScreenSpoofDetector
import com.datalakeauth.models.SilentFaceEngine
import com.datalakeauth.preprocessing.ImageCropUtils.FaceBox
import com.datalakeauth.registration.RegistrationEngine

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
    private val screenSpoofDetector = ScreenSpoofDetector()
    private val faceNetEngine = FaceNetEngine(context)
    private val registrationEngine = RegistrationEngine(context)

    // State for session-based spoofing (fused screen replay + SilentFace score window)
    private val recentSilentSpoofScores = mutableListOf<Float>()
    private val recentScreenScores = mutableListOf<Float>()
    private val recentFusedSpoofScores = mutableListOf<Float>()
    private var sessionSpoofPassed = false
    private var lastLiveScore = 0f
    private var lastSpoofScore = 0f
    private var lastScreenScore = 0f
    private var lastFusedSpoofScore = 0f
    private var consecutiveRecognitionFailures = 0
    
    // State for Session-based Liveness (pass once per session)
    private var sessionLivenessPassed = false
    private var livenessReasonCache: String = ""

    fun resetSession() {
        recentSilentSpoofScores.clear()
        recentScreenScores.clear()
        recentFusedSpoofScores.clear()
        screenSpoofDetector.reset()
        sessionSpoofPassed = false
        sessionLivenessPassed = false
        livenessReasonCache = ""
        lastLiveScore = 0f
        lastSpoofScore = 0f
        lastScreenScore = 0f
        lastFusedSpoofScore = 0f
        consecutiveRecognitionFailures = 0
    }

    private var debugFrameCount = 0

    /**
     * Runs the full attendance verification pipeline with parallel liveness.
     *
     * @param bitmap              The full camera frame as a Bitmap
     * @param faceBox             The detected face bounding box
     * @param faceMeshLandmarks   The 468 MediaPipe FaceMesh landmarks (pixel coords)
     * @param storedEmbeddings    The user's stored embeddings from SQLite
     * @param similarityThreshold Cosine similarity threshold for match (default 0.70)
     *
     * @return A Map<String, Any?> serialized to JSON for React Native
     */
    fun verifyAttendance(
        bitmap: Bitmap,
        faceBox: FaceBox,
        faceMeshLandmarks: List<LandmarkPoint>,
        storedEmbeddings: Map<String, FloatArray>,
        similarityThreshold: Float = 0.85f,
        qualityPassed: Boolean = true,
        qualityReason: String? = null
    ): Map<String, Any?> {
        debugFrameCount++
        android.util.Log.d("FaceAuth", "FRAME_COUNT_DEBUG processing frame $debugFrameCount")

        // ============================================================
        // STEP 0: Active Liveness (Pure Math)
        // Runs immediately on EVERY frame to track blinks (even blurry ones!)
        // ============================================================
        val liveness = ActiveLivenessEngine.evaluate(
            landmarks = faceMeshLandmarks,
            faceBoxX = faceBox.x,
            faceBoxY = faceBox.y,
            faceBoxW = faceBox.width,
            faceBoxH = faceBox.height
        )
        
        if (liveness.livenessPass) {
            sessionLivenessPassed = true
        }
        android.util.Log.d("FaceAuth", "LIVENESS_DEBUG pass=${liveness.livenessPass} blink=${liveness.blinkDetected}(L:${liveness.leftEyeAspectRatio} R:${liveness.rightEyeAspectRatio}) smile=${liveness.smileDetected}(w=${liveness.smileWidthRatio}) turn=${liveness.headTurnDetected}(off=${liveness.headTurnOffset})")

        // ============================================================
        // STEP 1: Face Quality Check
        // ============================================================
        if (!qualityPassed) {
            return buildResult(
                status = "RETRY",
                reason = qualityReason ?: "Poor image quality. Please adjust lighting or hold still.",
                isLive = null,
                liveScore = null,
                spoofScore = null,
                qualityPassed = false,
                liveness = liveness // Pass updated state back so UI still updates!
            )
        }

        // ============================================================
        // STEP 2: Passive Anti-Spoof
        // Fuses a screen replay score with SilentFace spoof confidence over 10 quality frames.
        // ============================================================
        if (!sessionSpoofPassed) {
            val screenResult = screenSpoofDetector.analyze(bitmap, faceBox)
            val spoofResult = silentFaceEngine.verify(bitmap, faceBox)

            lastLiveScore = spoofResult.liveScore
            lastSpoofScore = spoofResult.spoofScore
            lastScreenScore = screenResult.screenScore
            lastFusedSpoofScore = minOf(1.0f, spoofResult.spoofScore + (screenResult.screenScore * 0.35f))

            android.util.Log.d(
                "FaceAuth",
                "SPOOF_FUSED_DEBUG isLive=${spoofResult.isLive} liveScore=${spoofResult.liveScore} " +
                    "spoofScore=${spoofResult.spoofScore} screenScore=${screenResult.screenScore} " +
                    "flicker=${screenResult.flickerScore} texture=${screenResult.textureScore} " +
                    "fused=$lastFusedSpoofScore screenFrames=${screenResult.framesCollected} reason=${screenResult.reason}"
            )

            if (screenResult.screenScore >= HARD_SCREEN_SCORE_THRESHOLD ||
                lastFusedSpoofScore >= HARD_FUSED_SPOOF_THRESHOLD
            ) {
                val finalLiveScore = lastLiveScore
                val finalSpoofScore = lastFusedSpoofScore
                val finalScreenScore = lastScreenScore
                android.util.Log.d(
                    "FaceAuth",
                    "SPOOF_FUSED_HARD_REJECT screen=$lastScreenScore fused=$lastFusedSpoofScore"
                )
                resetSession()
                return buildResult(
                    status = "REJECT",
                    reason = "Spoof detected. This may be a screen replay.",
                    isLive = false,
                    liveScore = finalLiveScore,
                    spoofScore = finalSpoofScore,
                    qualityPassed = true,
                    liveness = liveness,
                    screenScore = finalScreenScore,
                    fusedSpoofScore = finalSpoofScore
                )
            }

            recentSilentSpoofScores.add(spoofResult.spoofScore)
            recentScreenScores.add(screenResult.screenScore)
            recentFusedSpoofScores.add(lastFusedSpoofScore)

            if (recentFusedSpoofScores.size < SPOOF_SCORE_WINDOW) {
                return buildResult(
                    status = "RETRY",
                    reason = "Analyzing face... Please hold still.",
                    isLive = null,
                    liveScore = lastLiveScore,
                    spoofScore = lastFusedSpoofScore,
                    qualityPassed = true,
                    liveness = liveness,
                    screenScore = lastScreenScore,
                    fusedSpoofScore = lastFusedSpoofScore
                )
            }

            val avgSilentSpoof = recentSilentSpoofScores.average().toFloat()
            val avgScreenScore = recentScreenScores.average().toFloat()
            val avgFusedSpoof = recentFusedSpoofScores.average().toFloat()

            android.util.Log.d(
                "FaceAuth",
                "SPOOF_FUSED_AVG avgSilent=$avgSilentSpoof avgScreen=$avgScreenScore avgFused=$avgFusedSpoof"
            )

            if (avgFusedSpoof >= AVG_FUSED_SPOOF_THRESHOLD ||
                (avgSilentSpoof > AVG_SILENT_SPOOF_THRESHOLD && avgScreenScore > AVG_SCREEN_SCORE_THRESHOLD)
            ) {
                resetSession()
                return buildResult(
                    status = "REJECT",
                    reason = "Spoof detected. This may be a screen replay.",
                    isLive = false,
                    liveScore = lastLiveScore,
                    spoofScore = avgFusedSpoof,
                    qualityPassed = true,
                    liveness = liveness,
                    screenScore = avgScreenScore,
                    fusedSpoofScore = avgFusedSpoof
                )
            } else {
                sessionSpoofPassed = true
                lastSpoofScore = avgSilentSpoof
                lastScreenScore = avgScreenScore
                lastFusedSpoofScore = avgFusedSpoof
                android.util.Log.d("FaceAuth", "SPOOF_FUSED_PASSED avgFused=$avgFusedSpoof")
            }
        }

        // Gate: If no blink/smile yet in this session, ask for it
        if (!sessionLivenessPassed) {
            return buildResult(
                status = "RETRY",
                reason = "Please blink, smile, or shake your head.",
                isLive = true,
                liveScore = lastLiveScore,
                spoofScore = lastSpoofScore,
                qualityPassed = true,
                liveness = liveness,
                screenScore = lastScreenScore,
                fusedSpoofScore = lastFusedSpoofScore
            )
        }

        // ============================================================
        // STEP 3: Face Recognition (MobileFaceNet)
        // Runs ONLY after both liveness checks pass.
        // ============================================================
        val embedding = faceNetEngine.extractEmbedding(bitmap, faceBox)
        val matchResult = faceNetEngine.match(embedding, storedEmbeddings, similarityThreshold)

        android.util.Log.d("FaceAuth", "RECOGNITION_DEBUG matched=${matchResult.matched} score=${matchResult.recognitionScore} userId=${matchResult.matchedUserId}")

        if (!matchResult.matched) {
            consecutiveRecognitionFailures++
            if (consecutiveRecognitionFailures >= 5) {
                resetSession()
                return buildResult(
                    status = "REJECT",
                    reason = "Face not recognized. No matching user found.",
                    isLive = true,
                    liveScore = lastLiveScore,
                    spoofScore = lastSpoofScore,
                    qualityPassed = true,
                    liveness = liveness,
                    matchedUserId = null,
                    recognitionScore = matchResult.recognitionScore,
                    screenScore = lastScreenScore,
                    fusedSpoofScore = lastFusedSpoofScore
                )
            } else {
                return buildResult(
                    status = "RETRY",
                    reason = "",
                    isLive = true,
                    liveScore = lastLiveScore,
                    spoofScore = lastSpoofScore,
                    qualityPassed = true,
                    liveness = liveness,
                    matchedUserId = null,
                    recognitionScore = matchResult.recognitionScore,
                    screenScore = lastScreenScore,
                    fusedSpoofScore = lastFusedSpoofScore
                )
            }
        }

        // ============================================================
        // STEP 4: SUCCESS — All checks passed
        // ============================================================
        resetSession() // CRITICAL FIX: Reset state for the NEXT scan
        return buildResult(
            status = "ACCEPT",
            reason = "Attendance verified successfully.",
            isLive = true,
            liveScore = lastLiveScore,
            spoofScore = lastSpoofScore,
            qualityPassed = true,
            liveness = liveness,
            matchedUserId = matchResult.matchedUserId,
            recognitionScore = matchResult.recognitionScore,
            screenScore = lastScreenScore,
            fusedSpoofScore = lastFusedSpoofScore
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
        isLive: Boolean?,
        liveScore: Float?,
        spoofScore: Float?,
        qualityPassed: Boolean,
        liveness: ActiveLivenessEngine.LivenessResult?,
        matchedUserId: String? = null,
        recognitionScore: Float? = null,
        screenScore: Float? = null,
        fusedSpoofScore: Float? = null
    ): Map<String, Any?> {
        return mapOf(
            "status" to status,
            "decision" to status,
            "reason" to reason,
            "faceDetected" to true,
            "isLive" to isLive,
            "liveScore" to liveScore?.toDouble(),
            "spoofScore" to spoofScore?.toDouble(),
            "qualityPassed" to qualityPassed,
            "blinkDetected" to liveness?.blinkDetected,
            "smileDetected" to liveness?.smileDetected,
            "headTurnDetected" to liveness?.headTurnDetected,
            "matchedUserId" to matchedUserId,
            "recognitionScore" to recognitionScore?.toDouble(),
            "screenScore" to screenScore?.toDouble(),
            "fusedSpoofScore" to fusedSpoofScore?.toDouble()
        )
    }

    companion object {
        private const val SPOOF_SCORE_WINDOW = 5
        private const val HARD_SCREEN_SCORE_THRESHOLD = 0.85f
        private const val HARD_FUSED_SPOOF_THRESHOLD = 0.85f // Was 0.45. Only hard reject on absolute certainty
        private const val AVG_FUSED_SPOOF_THRESHOLD = 0.45f // Was 0.25. Average must be high to reject
        private const val AVG_SILENT_SPOOF_THRESHOLD = 0.35f
        private const val AVG_SCREEN_SCORE_THRESHOLD = 0.40f
    }
}
