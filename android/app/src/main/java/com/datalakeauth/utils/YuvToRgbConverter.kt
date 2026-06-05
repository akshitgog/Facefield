package com.datalakeauth.utils

import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.media.Image
import java.nio.ByteBuffer
import kotlin.math.max
import kotlin.math.min

object YuvToRgbConverter {
    fun imageToBitmap(image: Image): Bitmap? {
        if (image.format != ImageFormat.YUV_420_888) return null

        val width = image.width
        val height = image.height

        val yPlane = image.planes[0]
        val uPlane = image.planes[1]
        val vPlane = image.planes[2]

        val yBuffer = yPlane.buffer
        val uBuffer = uPlane.buffer
        val vBuffer = vPlane.buffer

        val yRowStride = yPlane.rowStride
        val uRowStride = uPlane.rowStride
        val vRowStride = vPlane.rowStride

        val uPixelStride = uPlane.pixelStride
        val vPixelStride = vPlane.pixelStride

        val argbArray = IntArray(width * height)

        var yPos = 0
        for (y in 0 until height) {
            val uPosBase = (y / 2) * uRowStride
            val vPosBase = (y / 2) * vRowStride

            for (x in 0 until width) {
                // Read Y, U, V components (Y is 0-255, U and V are shifted by 128)
                val yValue = (yBuffer.get(yPos + x).toInt() and 0xFF)
                val uValue = (uBuffer.get(uPosBase + (x / 2) * uPixelStride).toInt() and 0xFF) - 128
                val vValue = (vBuffer.get(vPosBase + (x / 2) * vPixelStride).toInt() and 0xFF) - 128

                // Integer math for standard BT.601 YUV to RGB conversion
                var r = yValue + (1.370705f * vValue).toInt()
                var g = yValue - (0.337633f * uValue).toInt() - (0.698001f * vValue).toInt()
                var b = yValue + (1.732446f * uValue).toInt()

                // Clamp to 0..255
                r = max(0, min(255, r))
                g = max(0, min(255, g))
                b = max(0, min(255, b))

                // Pack into ARGB Int
                argbArray[y * width + x] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
            }
            yPos += yRowStride
        }

        // Create bitmap directly from ARGB array (lossless, preserves high-frequency Moiré patterns)
        return Bitmap.createBitmap(argbArray, width, height, Bitmap.Config.ARGB_8888)
    }
}
