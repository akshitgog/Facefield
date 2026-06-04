package com.datalakeauth.models

import android.content.Context
import android.graphics.Bitmap
import com.datalakeauth.preprocessing.ImageCropUtils
import com.datalakeauth.preprocessing.ImageCropUtils.FaceBox
import com.datalakeauth.preprocessing.TensorPacker
import com.datalakeauth.utils.MathUtils
import org.tensorflow.lite.Interpreter
import java.io.FileInputStream
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel

/**
 * SilentFace anti-spoofing engine — runs the 2.7x and 4.0x TFLite models.
 *
 * Python reference: laptop pipelinetesing/src/module/silentface/inference.py
 *   - SilentFaceEnsemble.predict(tensor_2_7, tensor_4_0)
 *
 * Pipeline:
 *   1. Crop the face at 2.7x scale → resize to 80x80
 *   2. Crop the face at 4.0x scale → resize to 80x80
 *   3. Pack both crops as BGR, float32, 0..255, NCHW tensors
 *   4. Run both TFLite models
 *   5. Softmax both outputs, sum probabilities, argmax == 1 → LIVE
 */
class SilentFaceEngine(context: Context) {

    private val interpreter27: Interpreter
    private val interpreter40: Interpreter

    init {
        interpreter27 = Interpreter(loadModelFile(context, "silentface_2_7_drq.tflite"))
        interpreter40 = Interpreter(loadModelFile(context, "silentface_4_0_drq.tflite"))
    }

    /**
     * Runs both SilentFace models on the frame and returns the liveness result.
     *
     * Python equivalent (test_pipeline.py lines 228-233):
     *   tensor_2_7 = preprocess_image(image, face_box, channel, config_2_7)
     *   tensor_4_0 = preprocess_image(image, face_box, channel, config_4_0)
     *   result = silent_face.predict(tensor_2_7, tensor_4_0)
     */
    fun verify(bitmap: Bitmap, faceBox: FaceBox): LivenessResult {
        // Step 1: Crop at 2.7x scale, resize to 80x80
        val crop27 = ImageCropUtils.getSilentfaceScaledCrop(bitmap, faceBox, 2.7f)
        val resized27 = Bitmap.createScaledBitmap(crop27, 80, 80, true)

        // Step 2: Crop at 4.0x scale, resize to 80x80
        val crop40 = ImageCropUtils.getSilentfaceScaledCrop(bitmap, faceBox, 4.0f)
        val resized40 = Bitmap.createScaledBitmap(crop40, 80, 80, true)

        // Step 3: Pack as BGR, float32, 0..255, NCHW tensors
        val tensor27 = TensorPacker.packForSilentFace(resized27)
        val tensor40 = TensorPacker.packForSilentFace(resized40)

        // Step 4: Run inference
        // master.md lines 430-439: rawScores are [number, number, number] (3 classes)
        // Class 0 = spoof, Class 1 = live, Class 2 = spoof
        val output27 = Array(1) { FloatArray(3) }
        val output40 = Array(1) { FloatArray(3) }
        interpreter27.run(tensor27, output27)
        interpreter40.run(tensor40, output40)

        // Step 5: Softmax both, sum, decision
        // master.md lines 444-451:
        //   - Apply softmax to each model output.
        //   - Sum both probability vectors.
        //   - Final class is argmax(summedProbabilities).
        //   - Class 1 means live. Classes 0 and 2 mean spoof.
        //   - liveScore = summedProbabilities[1] / 2
        //   - spoofScore = max(summedProbabilities[0], summedProbabilities[2]) / 2
        val prob27 = MathUtils.softmax(output27[0])
        val prob40 = MathUtils.softmax(output40[0])

        val sumProbs = FloatArray(3) { prob27[it] + prob40[it] }

        // argmax: class 1 = live, classes 0 and 2 = spoof
        val maxIndex = sumProbs.indices.maxByOrNull { sumProbs[it] } ?: 0
        val isLive = maxIndex == 1

        val liveScore = sumProbs[1] / 2.0f
        val spoofScore = maxOf(sumProbs[0], sumProbs[2]) / 2.0f

        return LivenessResult(
            isLive = isLive,
            liveScore = liveScore,
            spoofScore = spoofScore
        )
    }

    fun close() {
        interpreter27.close()
        interpreter40.close()
    }

    data class LivenessResult(
        val isLive: Boolean,
        val liveScore: Float,
        val spoofScore: Float
    )

    companion object {
        private fun loadModelFile(context: Context, modelName: String): MappedByteBuffer {
            val fileDescriptor = context.assets.openFd(modelName)
            val inputStream = FileInputStream(fileDescriptor.fileDescriptor)
            val fileChannel = inputStream.channel
            val startOffset = fileDescriptor.startOffset
            val declaredLength = fileDescriptor.declaredLength
            return fileChannel.map(FileChannel.MapMode.READ_ONLY, startOffset, declaredLength)
        }
    }
}
