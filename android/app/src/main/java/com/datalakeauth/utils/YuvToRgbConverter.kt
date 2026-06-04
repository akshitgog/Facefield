package com.datalakeauth.utils

import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.graphics.Rect
import android.media.Image
import java.nio.ByteBuffer

object YuvToRgbConverter {
    fun yuv420ThreePlanesToNV21(
        yPlane: ByteBuffer, uPlane: ByteBuffer, vPlane: ByteBuffer,
        yPixelStride: Int, uPixelStride: Int, vPixelStride: Int,
        yRowStride: Int, uRowStride: Int, vRowStride: Int,
        width: Int, height: Int
    ): ByteArray {
        val nv21 = ByteArray(width * height * 3 / 2)
        var pos = 0

        if (yPixelStride == 1 && yRowStride == width) {
            yPlane.position(0)
            yPlane.get(nv21, 0, width * height)
            pos = width * height
        } else {
            var yPos = 0
            for (row in 0 until height) {
                yPlane.position(yPos)
                for (col in 0 until width) {
                    nv21[pos++] = yPlane.get()
                }
                yPos += yRowStride
            }
        }

        var vPos = 0
        var uPos = 0
        for (row in 0 until height / 2) {
            vPlane.position(vPos)
            uPlane.position(uPos)
            for (col in 0 until width / 2) {
                nv21[pos++] = vPlane.get()
                nv21[pos++] = uPlane.get()
                if (col < width / 2 - 1) {
                    vPlane.position(vPlane.position() + vPixelStride - 1)
                    uPlane.position(uPlane.position() + uPixelStride - 1)
                }
            }
            vPos += vRowStride
            uPos += uRowStride
        }
        return nv21
    }

    fun imageToBitmap(image: Image): Bitmap? {
        if (image.format != ImageFormat.YUV_420_888) return null
        val yBuffer = image.planes[0].buffer
        val uBuffer = image.planes[1].buffer
        val vBuffer = image.planes[2].buffer

        val ySize = yBuffer.remaining()
        val uSize = uBuffer.remaining()
        val vSize = vBuffer.remaining()

        val nv21 = yuv420ThreePlanesToNV21(
            yBuffer, uBuffer, vBuffer,
            image.planes[0].pixelStride, image.planes[1].pixelStride, image.planes[2].pixelStride,
            image.planes[0].rowStride, image.planes[1].rowStride, image.planes[2].rowStride,
            image.width, image.height
        )
        
        val yuvImage = android.graphics.YuvImage(nv21, ImageFormat.NV21, image.width, image.height, null)
        val out = java.io.ByteArrayOutputStream()
        yuvImage.compressToJpeg(Rect(0, 0, image.width, image.height), 100, out)
        val imageBytes = out.toByteArray()
        return android.graphics.BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)
    }
}
