package com.datalakeauth.preprocessing

import android.graphics.Bitmap
import android.graphics.Color
import kotlin.math.abs

object FaceQualityChecker {

    /**
     * Data class to hold quality evaluation results.
     */
    data class QualityResult(
        val lightingGood: Boolean,
        val sharpnessGood: Boolean,
        val brightnessAvg: Float,
        val sharpnessScore: Float
    )

    /**
     * Evaluates lighting (brightness) and sharpness (Laplacian variance) on a cropped face bitmap.
     * 
     * Lighting rule: Must be > 15% brightness (too dark is bad) AND < 85% brightness (too bright/outdoor overexposure is bad).
     * Sharpness rule: Simple variance of laplacian (or a lightweight approximation) to ensure it's not overly blurry.
     */
    fun evaluate(faceCrop: Bitmap): QualityResult {
        var brightnessSum = 0f
        var maxBrightness = 0f
        val pixels = IntArray(faceCrop.width * faceCrop.height)
        faceCrop.getPixels(pixels, 0, faceCrop.width, 0, 0, faceCrop.width, faceCrop.height)

        val width = faceCrop.width
        val height = faceCrop.height

        // Calculate average brightness
        for (pixel in pixels) {
            // Standard luminance formula
            val r = Color.red(pixel)
            val g = Color.green(pixel)
            val b = Color.blue(pixel)
            val luminance = 0.299f * r + 0.587f * g + 0.114f * b
            brightnessSum += luminance
        }

        // Average brightness on a 0-255 scale
        val avgBrightness = brightnessSum / pixels.size
        // Convert to percentage (0.0 to 1.0)
        val brightnessPercent = avgBrightness / 255f

        // Lighting must be between 15% and 85% to pass (protects against dark rooms and extreme outdoor sunlight)
        val lightingGood = brightnessPercent > 0.15f && brightnessPercent < 0.85f

        // Calculate a lightweight Sharpness Approximation (sum of absolute differences with neighbors)
        // A true Laplacian is expensive on the UI thread, so we use a fast approximation:
        var diffSum = 0f
        var count = 0
        for (y in 1 until height - 1 step 2) {
            for (x in 1 until width - 1 step 2) {
                val pCenter = Color.green(pixels[y * width + x])
                val pRight = Color.green(pixels[y * width + (x + 1)])
                val pDown = Color.green(pixels[(y + 1) * width + x])
                
                diffSum += abs(pCenter - pRight) + abs(pCenter - pDown)
                count += 2
            }
        }
        val sharpnessScore = if (count > 0) diffSum / count else 0f
        // Threshold: highly blurred images have very low difference between adjacent pixels.
        val sharpnessGood = sharpnessScore > 5.0f

        return QualityResult(
            lightingGood = lightingGood,
            sharpnessGood = sharpnessGood,
            brightnessAvg = brightnessPercent,
            sharpnessScore = sharpnessScore
        )
    }
}
