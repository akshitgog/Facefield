package com.datalakeauth.preprocessing

import android.graphics.Bitmap
import android.graphics.Color
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Converts Bitmaps into TFLite-ready float tensors.
 *
 * Python reference: laptop pipelinetesing/src/module/preprocessing/utils.py
 *   - convert_channel_order (lines 149-158)
 *   - convert_to_tensor (lines 161-186)
 */
object TensorPacker {

    /**
     * Packs a Bitmap into a ByteBuffer for SilentFace TFLite models.
     *
     * SilentFace requirements (from YAML config):
     *   - Input size: 80x80
     *   - Channel order: BGR
     *   - Pixel range: 0..255 (do NOT divide by 255)
     *   - Tensor layout: NCHW  → shape [1, 3, 80, 80]
     *   - dtype: float32
     *
     * Python equivalent (convert_to_tensor):
     *   tensor = image.astype(np.float32)          # no division
     *   tensor = np.transpose(tensor, (2, 0, 1))   # HWC -> CHW
     *   tensor = np.expand_dims(tensor, axis=0)     # add batch dim
     */
    fun packForSilentFace(bitmap: Bitmap): ByteBuffer {
        val width = 80
        val height = 80
        val resized = if (bitmap.width != width || bitmap.height != height) {
            Bitmap.createScaledBitmap(bitmap, width, height, true)
        } else bitmap

        // NCHW: [1, 3, H, W] → 1 * 3 * 80 * 80 * 4 bytes
        val buffer = ByteBuffer.allocateDirect(1 * 3 * height * width * 4)
        buffer.order(ByteOrder.nativeOrder())

        val pixels = IntArray(width * height)
        resized.getPixels(pixels, 0, width, 0, 0, width, height)

        // NHWC layout: write B, G, R interleaved
        for (y in 0 until height) {
            for (x in 0 until width) {
                val pixel = pixels[y * width + x]
                buffer.putFloat(Color.blue(pixel).toFloat())   // B
                buffer.putFloat(Color.green(pixel).toFloat())  // G
                buffer.putFloat(Color.red(pixel).toFloat())    // R
            }
        }

        buffer.rewind()
        return buffer
    }

    /**
     * Packs a Bitmap into a ByteBuffer for MobileFaceNet TFLite model.
     *
     * MobileFaceNet requirements (from YAML config: mobilefacenet.yaml):
     *   - Input size: 112x112
     *   - Channel order: RGB
     *   - Pixel range: "minus1_1"  ← CRITICAL: NOT 0..1
     *   - Tensor layout: NHWC  → shape [1, 112, 112, 3]
     *   - dtype: float32
     */
    fun packForMobileFaceNet(bitmap: Bitmap): ByteBuffer {
        val width = 112
        val height = 112
        val resized = if (bitmap.width != width || bitmap.height != height) {
            Bitmap.createScaledBitmap(bitmap, width, height, true)
        } else bitmap

        // NHWC: [1, H, W, 3] → 1 * 112 * 112 * 3 * 4 bytes
        val buffer = ByteBuffer.allocateDirect(1 * height * width * 3 * 4)
        buffer.order(ByteOrder.nativeOrder())

        val pixels = IntArray(width * height)
        resized.getPixels(pixels, 0, width, 0, 0, width, height)

        // NHWC layout: R, G, B interleaved
        // Normalization: (pixel - 127.5) / 128.0  → maps 0..255 to -1..1
        for (y in 0 until height) {
            for (x in 0 until width) {
                val pixel = pixels[y * width + x]
                buffer.putFloat((Color.red(pixel).toFloat() - 127.5f) / 128.0f)
                buffer.putFloat((Color.green(pixel).toFloat() - 127.5f) / 128.0f)
                buffer.putFloat((Color.blue(pixel).toFloat() - 127.5f) / 128.0f)
            }
        }

        buffer.rewind()
        return buffer
    }
}
