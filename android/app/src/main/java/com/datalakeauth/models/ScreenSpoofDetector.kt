package com.datalakeauth.models

import android.graphics.Bitmap
import android.graphics.Color
import com.datalakeauth.preprocessing.ImageCropUtils
import com.datalakeauth.preprocessing.ImageCropUtils.FaceBox
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Lightweight screen replay risk detector.
 *
 * This detector does not replace SilentFace. It produces a screenScore that the
 * orchestrator fuses with SilentFace spoof confidence.
 */
class ScreenSpoofDetector {

    private val lumaHistory = FloatArray(TEMPORAL_WINDOW)
    private var historyCount = 0
    private var historyIndex = 0

    private val pixels = IntArray(CROP_SIZE * CROP_SIZE)
    private val gray = FloatArray(CROP_SIZE * CROP_SIZE)

    fun analyze(bitmap: Bitmap, faceBox: FaceBox): ScreenSpoofResult {
        val crop = ImageCropUtils.getAlignedFaceCrop(bitmap, faceBox, CROP_SIZE, CROP_SIZE)
        crop.getPixels(pixels, 0, CROP_SIZE, 0, 0, CROP_SIZE, CROP_SIZE)

        var lumaSum = 0f
        for (i in pixels.indices) {
            val pixel = pixels[i]
            val luma = (
                0.299f * Color.red(pixel) +
                    0.587f * Color.green(pixel) +
                    0.114f * Color.blue(pixel)
                ) / 255f
            gray[i] = luma
            lumaSum += luma
        }

        val meanLuma = lumaSum / pixels.size
        pushLuma(meanLuma)

        val flickerScore = computeFlickerScore()
        val textureScore = computeTextureScore()
        val screenScore = clamp01(flickerScore * 0.65f + textureScore * 0.35f)
        val reason = when {
            screenScore >= 0.85f -> "High-confidence screen replay signal."
            flickerScore > textureScore && flickerScore >= 0.35f -> "Temporal screen flicker detected."
            textureScore >= 0.35f -> "High-frequency screen texture detected."
            historyCount < MIN_TEMPORAL_FRAMES -> "Collecting temporal screen samples."
            else -> "No strong screen replay signal."
        }

        return ScreenSpoofResult(
            screenScore = screenScore,
            flickerScore = flickerScore,
            textureScore = textureScore,
            framesCollected = historyCount,
            reason = reason
        )
    }

    fun reset() {
        historyCount = 0
        historyIndex = 0
        lumaHistory.fill(0f)
    }

    private fun pushLuma(value: Float) {
        lumaHistory[historyIndex] = value
        historyIndex = (historyIndex + 1) % TEMPORAL_WINDOW
        historyCount = min(TEMPORAL_WINDOW, historyCount + 1)
    }

    private fun computeFlickerScore(): Float {
        if (historyCount < MIN_TEMPORAL_FRAMES) return 0f

        var totalAbsDelta = 0f
        var signChanges = 0
        var previousDelta = 0f

        for (i in 1 until historyCount) {
            val current = getHistoryValue(i)
            val previous = getHistoryValue(i - 1)
            val delta = current - previous
            totalAbsDelta += abs(delta)

            if (i > 1 && delta != 0f && previousDelta != 0f) {
                if ((delta > 0f && previousDelta < 0f) || (delta < 0f && previousDelta > 0f)) {
                    signChanges++
                }
            }
            previousDelta = delta
        }

        val avgAbsDelta = totalAbsDelta / max(1, historyCount - 1)
        val oscillationRatio = signChanges.toFloat() / max(1, historyCount - 2)

        val amplitudeScore = normalize(avgAbsDelta, 0.006f, 0.035f)
        val oscillationScore = normalize(oscillationRatio, 0.35f, 0.80f)
        return clamp01(amplitudeScore * (0.55f + 0.45f * oscillationScore))
    }

    private fun getHistoryValue(age: Int): Float {
        val start = if (historyCount == TEMPORAL_WINDOW) historyIndex else 0
        return lumaHistory[(start + age) % TEMPORAL_WINDOW]
    }

    private fun computeTextureScore(): Float {
        var laplacianSum = 0f
        var gradientSum = 0f
        var samples = 0

        for (y in 1 until CROP_SIZE - 1) {
            val row = y * CROP_SIZE
            val rowUp = (y - 1) * CROP_SIZE
            val rowDown = (y + 1) * CROP_SIZE
            for (x in 1 until CROP_SIZE - 1) {
                val center = gray[row + x]
                val left = gray[row + x - 1]
                val right = gray[row + x + 1]
                val up = gray[rowUp + x]
                val down = gray[rowDown + x]

                laplacianSum += abs(4f * center - left - right - up - down)
                gradientSum += abs(right - left) + abs(down - up)
                samples++
            }
        }

        val avgLaplacian = laplacianSum / max(1, samples)
        val avgGradient = gradientSum / max(1, samples)
        val highFrequencyScore = normalize(avgLaplacian, 0.035f, 0.115f)
        val edgeScore = normalize(avgGradient, 0.080f, 0.220f)

        return clamp01(highFrequencyScore * 0.70f + edgeScore * 0.30f)
    }

    private fun normalize(value: Float, low: Float, high: Float): Float {
        if (high <= low) return 0f
        return clamp01((value - low) / (high - low))
    }

    private fun clamp01(value: Float): Float = min(1f, max(0f, value))

    data class ScreenSpoofResult(
        val screenScore: Float,
        val flickerScore: Float,
        val textureScore: Float,
        val framesCollected: Int,
        val reason: String
    )

    companion object {
        private const val CROP_SIZE = 112
        private const val TEMPORAL_WINDOW = 8
        private const val MIN_TEMPORAL_FRAMES = 4
    }
}
