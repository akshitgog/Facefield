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

    // State for Session-based Spoofing (3-frame majority vote)
    private var spoofVoteCount = 0
    private var spoofLiveVotes = 0
    private var sessionSpoofPassed = false
    private var lastLiveScore = 0f
    private var lastSpoofScore = 0f
    
    // State for Session-based Liveness (pass once per session)
    private var sessionLivenessPassed = false
    private var livenessReasonCache: String = ""

    fun resetSession() {
        spoofVoteCount = 0
        spoofLiveVotes = 0
        sessionSpoofPassed = false
        sessionLivenessPassed = false
        livenessReasonCache = ""
    }

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
        similarityThreshold: Float = 0.70f,
        qualityPassed: Boolean = true,
        qualityReason: String? = null
    ): Map<String, Any?> {

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
        android.util.Log.d("FaceAuth", "LIVENESS_DEBUG pass=${liveness.livenessPass} blink=${liveness.blinkDetected} smile=${liveness.smileDetected} turn=${liveness.headTurnDetected}")

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
        // STEP 2: SilentFace Anti-Spoof (TFLite Inference)
        // Runs ONLY on up to 3 quality frames to make a majority vote.
        // ============================================================
        if (!sessionSpoofPassed) {
            val spoofResult = silentFaceEngine.verify(bitmap, faceBox)
            android.util.Log.d("FaceAuth", "SPOOF_DEBUG isLive=${spoofResult.isLive} liveScore=${spoofResult.liveScore} spoofScore=${spoofResult.spoofScore}")
            
            spoofVoteCount++
            lastLiveScore = spoofResult.liveScore
            lastSpoofScore = spoofResult.spoofScore
            
            if (spoofResult.isLive) {
                spoofLiveVotes++
            }
            
            // Wait until we have 3 votes
            if (spoofVoteCount < 3) {
                return buildResult(
                    status = "RETRY",
                    reason = "Analyzing face... Please hold still.",
                    isLive = null,
                    liveScore = lastLiveScore,
                    spoofScore = lastSpoofScore,
                    qualityPassed = true,
                    liveness = liveness
                )
            }
            
            // We have 3 votes. Check majority (>= 2)
            if (spoofLiveVotes >= 2) {
                sessionSpoofPassed = true
                android.util.Log.d("FaceAuth", "SPOOF_VOTE_PASSED $spoofLiveVotes/3 votes")
            } else {
                // Failed majority vote. Reset and reject.
                android.util.Log.d("FaceAuth", "SPOOF_VOTE_FAILED $spoofLiveVotes/3 votes")
                val finalLiveScore = lastLiveScore
                val finalSpoofScore = lastSpoofScore
                resetSession() // Reset to try again
                return buildResult(
                    status = "REJECT",
                    reason = "Spoof detected. This does not appear to be a live face.",
                    isLive = false,
                    liveScore = finalLiveScore,
                    spoofScore = finalSpoofScore,
                    qualityPassed = true,
                    liveness = liveness
                )
            }
        }

        // Gate: If no blink/smile yet in this session, ask for it
        if (!sessionLivenessPassed) {
            return buildResult(
                status = "RETRY",
                reason = "Please blink, smile, or turn your head slightly.",
                isLive = true,
                liveScore = lastLiveScore,
                spoofScore = lastSpoofScore,
                qualityPassed = true,
                liveness = liveness
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
            return buildResult(
                status = "REJECT",
                reason = "Face not recognized. No matching user found.",
                isLive = true,
                liveScore = lastLiveScore,
                spoofScore = lastSpoofScore,
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
            liveScore = lastLiveScore,
            spoofScore = lastSpoofScore,
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
        isLive: Boolean?,
        liveScore: Float?,
        spoofScore: Float?,
        qualityPassed: Boolean,
        liveness: ActiveLivenessEngine.LivenessResult?,
        matchedUserId: String? = null,
        recognitionScore: Float? = null
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
            "recognitionScore" to recognitionScore?.toDouble()
        )
    }
}
