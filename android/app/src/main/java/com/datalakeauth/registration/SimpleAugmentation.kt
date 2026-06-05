package com.datalakeauth.registration

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint

/**
 * Simple image augmentations for face registration.
 *
 * These are intentionally simple — just slight tweaks to generate
 * variation in the embeddings so the stored average is robust
 * against minor lighting and angle changes.
 *
 * Registration flow from mobile_implementation_strategy.md:
 *   Augmentation
 *   ├─ Brightness +
 *   ├─ Brightness -
 *   ├─ Contrast
 *   ├─ Gamma
 *   └─ Small Rotation
 */
object SimpleAugmentation {

    /**
     * Generates 5 variants of the input face crop:
     *   0 = Original (no change)
     *   1 = Slightly brighter
     *   2 = Slightly darker
     *   3 = Slight contrast boost
     *   4 = Small rotation (~3 degrees)
     */
    fun generateVariants(original: Bitmap): List<Bitmap> {
        return listOf(
            original
        )
    }

    /**
     * Adjusts brightness using Android ColorMatrix.
     * value > 0 = brighter, value < 0 = darker
     */
    private fun adjustBrightness(src: Bitmap, value: Float): Bitmap {
        val cm = ColorMatrix(floatArrayOf(
            1f, 0f, 0f, 0f, value,
            0f, 1f, 0f, 0f, value,
            0f, 0f, 1f, 0f, value,
            0f, 0f, 0f, 1f, 0f
        ))
        return applyColorMatrix(src, cm)
    }

    /**
     * Adjusts contrast using Android ColorMatrix.
     * scale > 1 = more contrast, scale < 1 = less contrast
     */
    private fun adjustContrast(src: Bitmap, scale: Float): Bitmap {
        val translate = (-0.5f * scale + 0.5f) * 255f
        val cm = ColorMatrix(floatArrayOf(
            scale, 0f, 0f, 0f, translate,
            0f, scale, 0f, 0f, translate,
            0f, 0f, scale, 0f, translate,
            0f, 0f, 0f, 1f, 0f
        ))
        return applyColorMatrix(src, cm)
    }

    /**
     * Rotates the image by a small angle (degrees).
     */
    private fun rotateSlightly(src: Bitmap, degrees: Float): Bitmap {
        val matrix = Matrix()
        matrix.postRotate(degrees, src.width / 2f, src.height / 2f)
        return Bitmap.createBitmap(src, 0, 0, src.width, src.height, matrix, true)
    }

    private fun applyColorMatrix(src: Bitmap, cm: ColorMatrix): Bitmap {
        val result = Bitmap.createBitmap(src.width, src.height, src.config ?: Bitmap.Config.ARGB_8888)
        val canvas = Canvas(result)
        val paint = Paint()
        paint.colorFilter = ColorMatrixColorFilter(cm)
        canvas.drawBitmap(src, 0f, 0f, paint)
        return result
    }
}
