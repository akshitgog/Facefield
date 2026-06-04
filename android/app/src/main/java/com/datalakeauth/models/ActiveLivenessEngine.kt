package com.datalakeauth.models

import com.datalakeauth.utils.MathUtils
import kotlin.math.abs
import kotlin.math.max

/**
 * Active Liveness engine — evaluates blink, smile, and head turn from
 * MediaPipe FaceMesh 468 landmarks.
 *
 * Python reference: laptop pipelinetesing/src/module/facemesh/quality.py
 *   - FaceQualityChecker class (lines 5-188)
 *   - analyze_landmarks (lines 112-146)
 *   - _eye_aspect_ratio (lines 180-187)
 *
 * This is NOT ML Kit. We use the exact same landmark indices and threshold
 * values from the Python quality.py code.
 */
object ActiveLivenessEngine {

    // Exact landmark indices from quality.py (lines 6-10)
    private val LEFT_EYE = intArrayOf(33, 160, 158, 133, 153, 144)
    private val RIGHT_EYE = intArrayOf(362, 385, 387, 263, 373, 380)
    private val MOUTH_CORNERS = intArrayOf(61, 291)
    private val MOUTH_VERTICAL = intArrayOf(13, 14)
    private const val NOSE_TIP = 1

    // Exact thresholds from quality.py (lines 17-19)
    private const val BLINK_EAR_THRESHOLD = 0.20f
    private const val SMILE_WIDTH_RATIO_THRESHOLD = 0.42f
    private const val HEAD_TURN_OFFSET_THRESHOLD = 0.16f

    /**
     * Represents a single 2D landmark point (x, y in pixel coordinates).
     */
    data class LandmarkPoint(val x: Float, val y: Float)

    /**
     * Result of the active liveness check.
     * Mirrors the Python dict returned by analyze_landmarks.
     */
    data class LivenessResult(
        val blinkDetected: Boolean,
        val smileDetected: Boolean,
        val headTurnDetected: Boolean,
        val headTurnDirection: String?,  // "left", "right", or null
        val leftEyeAspectRatio: Float,
        val rightEyeAspectRatio: Float,
        val smileWidthRatio: Float,
        val headTurnOffset: Float,
        val livenessPass: Boolean   // blink OR smile OR headTurn
    )

    /**
     * Evaluates active liveness from MediaPipe FaceMesh landmarks.
     *
     * The caller must provide the 468 landmarks as a list of LandmarkPoint
     * (already converted from normalized [0..1] coordinates to pixel coordinates).
     *
     * Python equivalent: quality.py analyze_landmarks (lines 112-146)
     *
     * @param landmarks  468 MediaPipe FaceMesh landmarks in pixel coordinates
     * @param faceBoxX   Face bounding box x (pixels)
     * @param faceBoxY   Face bounding box y (pixels)
     * @param faceBoxW   Face bounding box width (pixels)
     * @param faceBoxH   Face bounding box height (pixels)
     */
    fun evaluate(
        landmarks: List<LandmarkPoint>,
        faceBoxX: Float,
        faceBoxY: Float,
        faceBoxW: Float,
        faceBoxH: Float
    ): LivenessResult {
        // ---------- Blink Detection (quality.py lines 113-115) ----------
        // Python:
        //   left_ear = _eye_aspect_ratio(landmarks, LEFT_EYE, ...)
        //   right_ear = _eye_aspect_ratio(landmarks, RIGHT_EYE, ...)
        //   blink_detected = min(left_ear, right_ear) < blink_ear_threshold
        val leftEAR = eyeAspectRatio(landmarks, LEFT_EYE)
        val rightEAR = eyeAspectRatio(landmarks, RIGHT_EYE)
        val blinkDetected = minOf(leftEAR, rightEAR) < BLINK_EAR_THRESHOLD

        // ---------- Smile Detection (quality.py lines 117-124) ----------
        // Python:
        //   mouth_width = distance(mouth_left, mouth_right)
        //   mouth_open = distance(mouth_top, mouth_bottom)
        //   smile_width_ratio = mouth_width / max(face_box_width, 1.0)
        //   smile_detected = smile_width_ratio >= 0.42 and mouth_open >= 1.0
        val mouthLeft = landmarks[MOUTH_CORNERS[0]]
        val mouthRight = landmarks[MOUTH_CORNERS[1]]
        val mouthTop = landmarks[MOUTH_VERTICAL[0]]
        val mouthBottom = landmarks[MOUTH_VERTICAL[1]]

        val mouthWidth = MathUtils.distance(mouthLeft.x, mouthLeft.y, mouthRight.x, mouthRight.y)
        val mouthOpen = MathUtils.distance(mouthTop.x, mouthTop.y, mouthBottom.x, mouthBottom.y)
        val smileWidthRatio = mouthWidth / max(faceBoxW, 1.0f)
        val smileDetected = smileWidthRatio >= SMILE_WIDTH_RATIO_THRESHOLD && mouthOpen >= 1.0f

        // ---------- Head Turn Detection (quality.py lines 126-132) ----------
        // Python:
        //   nose = _point(landmarks, NOSE_TIP, ...)
        //   face_center_x = face_box_x + face_box_width / 2
        //   normalized_offset = (nose_x - face_center_x) / max(face_box_width, 1.0)
        //   head_turn_detected = abs(normalized_offset) >= 0.16
        val nose = landmarks[NOSE_TIP]
        val faceCenterX = faceBoxX + faceBoxW / 2f
        val normalizedOffset = (nose.x - faceCenterX) / max(faceBoxW, 1.0f)
        val headTurnDetected = abs(normalizedOffset) >= HEAD_TURN_OFFSET_THRESHOLD
        val headTurnDirection: String? = if (headTurnDetected) {
            // Python line 132: "right" if normalized_offset < 0 else "left"
            if (normalizedOffset < 0) "right" else "left"
        } else null

        // ---------- Final Decision ----------
        // Our agreed-upon architecture: blink OR smile OR head_turn = PASS
        val livenessPass = blinkDetected || smileDetected || headTurnDetected

        return LivenessResult(
            blinkDetected = blinkDetected,
            smileDetected = smileDetected,
            headTurnDetected = headTurnDetected,
            headTurnDirection = headTurnDirection,
            leftEyeAspectRatio = leftEAR,
            rightEyeAspectRatio = rightEAR,
            smileWidthRatio = smileWidthRatio,
            headTurnOffset = normalizedOffset,
            livenessPass = livenessPass
        )
    }

    /**
     * Calculates the Eye Aspect Ratio (EAR).
     *
     * Python equivalent: quality.py _eye_aspect_ratio (lines 180-187)
     *   p1, p2, p3, p4, p5, p6 = [_point(landmarks, idx, ...) for idx in eye_indices]
     *   vertical = distance(p2, p6) + distance(p3, p5)
     *   horizontal = 2.0 * max(distance(p1, p4), 1.0)
     *   return vertical / horizontal
     */
    private fun eyeAspectRatio(landmarks: List<LandmarkPoint>, eyeIndices: IntArray): Float {
        val p1 = landmarks[eyeIndices[0]]
        val p2 = landmarks[eyeIndices[1]]
        val p3 = landmarks[eyeIndices[2]]
        val p4 = landmarks[eyeIndices[3]]
        val p5 = landmarks[eyeIndices[4]]
        val p6 = landmarks[eyeIndices[5]]

        val vertical = MathUtils.distance(p2.x, p2.y, p6.x, p6.y) +
                        MathUtils.distance(p3.x, p3.y, p5.x, p5.y)
        val horizontal = 2.0f * max(MathUtils.distance(p1.x, p1.y, p4.x, p4.y), 1.0f)

        return vertical / horizontal
    }
}
