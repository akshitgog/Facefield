package com.datalakeauth.preprocessing

import android.graphics.Bitmap
import kotlin.math.max
import kotlin.math.min

/**
 * Image cropping utilities — exact Kotlin translation of the Python preprocessing.
 *
 * Python reference: laptop pipelinetesing/src/module/preprocessing/utils.py
 *   - _silentface_scaled_box (lines 95-118)
 *   - get_silentface_scaled_crop (lines 121-125)
 *   - get_aligned_face_crop (lines 132-146)
 */
object ImageCropUtils {

    /**
     * Data class representing a detected face bounding box.
     * Mirrors the Python dict: {"x", "y", "width", "height", "confidence"}
     */
    data class FaceBox(
        val x: Float,
        val y: Float,
        val width: Float,
        val height: Float,
        val confidence: Float
    )

    /**
     * Validates and clamps a FaceBox to image boundaries.
     *
     * Python reference: validate_bbox (lines 73-88)
     */
    fun validateBBox(box: FaceBox, imageWidth: Int, imageHeight: Int): FaceBox {
        val x = max(0.0f, box.x)
        val y = max(0.0f, box.y)
        val w = max(1.0f, min(box.width, imageWidth.toFloat() - x))
        val h = max(1.0f, min(box.height, imageHeight.toFloat() - y))
        return FaceBox(x, y, w, h, box.confidence)
    }

    /**
     * Exact translation of Python _silentface_scaled_box (lines 95-118).
     *
     * Expands the bounding box by [scale] factor, then shifts it if it
     * overflows the image boundaries. Returns (left, top, right, bottom).
     *
     * Python:
     *   scale = min((src_h - 1) / box_h, min((src_w - 1) / box_w, scale))
     *   new_width  = box_w * scale
     *   new_height = box_h * scale
     *   center_x = box_w / 2 + x
     *   center_y = box_h / 2 + y
     *   left_top_x     = center_x - new_width / 2
     *   left_top_y     = center_y - new_height / 2
     *   right_bottom_x = center_x + new_width / 2
     *   right_bottom_y = center_y + new_height / 2
     *   ... boundary shift logic ...
     */
    fun silentfaceScaledBox(
        srcW: Int,
        srcH: Int,
        box: FaceBox,
        requestedScale: Float
    ): IntArray {
        val x = box.x.toDouble()
        val y = box.y.toDouble()
        val boxW = box.width.toDouble()
        val boxH = box.height.toDouble()

        // Python line 97: scale = min((src_h-1)/box_h, min((src_w-1)/box_w, scale))
        val scale = minOf(
            (srcH - 1).toDouble() / boxH,
            (srcW - 1).toDouble() / boxW,
            requestedScale.toDouble()
        )

        val newWidth = boxW * scale
        val newHeight = boxH * scale
        val centerX = boxW / 2.0 + x
        val centerY = boxH / 2.0 + y

        var leftTopX = centerX - newWidth / 2.0
        var leftTopY = centerY - newHeight / 2.0
        var rightBottomX = centerX + newWidth / 2.0
        var rightBottomY = centerY + newHeight / 2.0

        // Python lines 106-117: boundary shift logic
        if (leftTopX < 0) {
            rightBottomX -= leftTopX
            leftTopX = 0.0
        }
        if (leftTopY < 0) {
            rightBottomY -= leftTopY
            leftTopY = 0.0
        }
        if (rightBottomX > srcW - 1) {
            leftTopX -= (rightBottomX - srcW + 1)
            rightBottomX = (srcW - 1).toDouble()
        }
        if (rightBottomY > srcH - 1) {
            leftTopY -= (rightBottomY - srcH + 1)
            rightBottomY = (srcH - 1).toDouble()
        }

        return intArrayOf(
            leftTopX.toInt(),
            leftTopY.toInt(),
            rightBottomX.toInt(),
            rightBottomY.toInt()
        )
    }

    /**
     * Exact translation of Python get_silentface_scaled_crop (lines 121-125).
     *
     * Crops the bitmap using the scaled bounding box.
     *
     * Python:
     *   left, top, right, bottom = _silentface_scaled_box(src_w, src_h, bbox, scale)
     *   return image[top : bottom + 1, left : right + 1]
     */
    fun getSilentfaceScaledCrop(bitmap: Bitmap, box: FaceBox, scale: Float): Bitmap {
        val validated = validateBBox(box, bitmap.width, bitmap.height)
        val (left, top, right, bottom) = silentfaceScaledBox(
            bitmap.width, bitmap.height, validated, scale
        )

        // Clamp to valid bitmap region
        val safeLeft = max(0, left)
        val safeTop = max(0, top)
        val safeRight = min(bitmap.width - 1, right)
        val safeBottom = min(bitmap.height - 1, bottom)
        val cropW = safeRight - safeLeft + 1
        val cropH = safeBottom - safeTop + 1

        if (cropW <= 0 || cropH <= 0) {
            // Fallback: return the whole bitmap scaled down
            return Bitmap.createScaledBitmap(bitmap, 80, 80, true)
        }

        return Bitmap.createBitmap(bitmap, safeLeft, safeTop, cropW, cropH)
    }

    /**
     * Exact translation of Python get_aligned_face_crop (lines 132-146).
     *
     * Forces a perfect square crop around the face, then resizes to outputSize.
     *
     * Python:
     *   side = max(bbox["width"], bbox["height"])
     *   square = {
     *       "x": bbox["x"] + bbox["width"] / 2 - side / 2,
     *       "y": bbox["y"] + bbox["height"] / 2 - side / 2,
     *       "width": side, "height": side, "confidence": bbox["confidence"]
     *   }
     *   left, top, right, bottom = _silentface_scaled_box(img_w, img_h, square, 1.0)
     *   return resize(image[top:bottom+1, left:right+1], output_size)
     */
    fun getAlignedFaceCrop(
        bitmap: Bitmap,
        box: FaceBox,
        outputWidth: Int = 112,
        outputHeight: Int = 112
    ): Bitmap {
        val validated = validateBBox(box, bitmap.width, bitmap.height)
        val side = max(validated.width, validated.height)
        val squareBox = FaceBox(
            x = validated.x + validated.width / 2f - side / 2f,
            y = validated.y + validated.height / 2f - side / 2f,
            width = side,
            height = side,
            confidence = validated.confidence
        )

        // clean.py uses PADDING = 0.2 (20% on all sides), which equates to a 1.4x scale box.
        // MobileFaceNet was trained on this 1.4x crop, so we MUST use 1.4f here, not 1.0f!
        val (left, top, right, bottom) = silentfaceScaledBox(
            bitmap.width, bitmap.height, squareBox, 1.4f
        )

        val safeLeft = max(0, left)
        val safeTop = max(0, top)
        val safeRight = min(bitmap.width - 1, right)
        val safeBottom = min(bitmap.height - 1, bottom)
        val cropW = safeRight - safeLeft + 1
        val cropH = safeBottom - safeTop + 1

        if (cropW <= 0 || cropH <= 0) {
            return Bitmap.createScaledBitmap(bitmap, outputWidth, outputHeight, true)
        }

        val cropped = Bitmap.createBitmap(bitmap, safeLeft, safeTop, cropW, cropH)
        return Bitmap.createScaledBitmap(cropped, outputWidth, outputHeight, true)
    }

    /**
     * Gets a wider crop of the face for UI display purposes (includes hair/neck).
     */
    fun getDisplayFaceCrop(
        bitmap: Bitmap,
        box: FaceBox,
        outputWidth: Int = 400,
        outputHeight: Int = 400
    ): Bitmap {
        val validated = validateBBox(box, bitmap.width, bitmap.height)
        val side = max(validated.width, validated.height)
        val squareBox = FaceBox(
            x = validated.x + validated.width / 2f - side / 2f,
            y = validated.y + validated.height / 2f - side / 2f,
            width = side,
            height = side,
            confidence = validated.confidence
        )

        // Use 1.8f scale for a much wider crop suitable for profile pictures
        val (left, top, right, bottom) = silentfaceScaledBox(
            bitmap.width, bitmap.height, squareBox, 1.8f
        )

        val safeLeft = max(0, left)
        val safeTop = max(0, top)
        val safeRight = min(bitmap.width - 1, right)
        val safeBottom = min(bitmap.height - 1, bottom)
        val cropW = safeRight - safeLeft + 1
        val cropH = safeBottom - safeTop + 1

        if (cropW <= 0 || cropH <= 0) {
            return Bitmap.createScaledBitmap(bitmap, outputWidth, outputHeight, true)
        }

        val cropped = Bitmap.createBitmap(bitmap, safeLeft, safeTop, cropW, cropH)
        return Bitmap.createScaledBitmap(cropped, outputWidth, outputHeight, true)
    }
}
