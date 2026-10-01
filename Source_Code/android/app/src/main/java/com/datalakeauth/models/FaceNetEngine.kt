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
 * MobileFaceNet recognition engine — extracts face embeddings and matches
 * them against stored embeddings using cosine similarity.
 *
 * Python reference:
 *   - laptop pipelinetesing/src/module/mobilefacenet/recognition.py
 *   - laptop pipelinetesing/test_pipeline.py (lines 109-122, 236-244)
 *
 * Pipeline:
 *   1. Align the face → square crop → resize to 112x112
 *   2. Pack as RGB, float32, 0..1 (divide by 255), NCHW tensor
 *   3. Run MobileFaceNet TFLite model
 *   4. Extract the 1D embedding vector
 *   5. L2-normalize the embedding
 */
class FaceNetEngine(context: Context) {

    private val interpreter: Interpreter
    private val embeddingSize: Int

    init {
        interpreter = Interpreter(loadModelFile(context, "mobilefacenet_drq.tflite"))
        // Determine embedding size from the model output shape
        val outputShape = interpreter.getOutputTensor(0).shape()
        embeddingSize = outputShape[outputShape.size - 1]
    }

    /**
     * Extracts a face embedding from the bitmap.
     *
     * Python equivalent (test_pipeline.py lines 115-121):
     *   tensor = preprocess_image(image, face_box, pixelFormat, mobilefacenet_config)
     *   embedding = face_net.get_embedding(tensor)
     */
    fun extractEmbedding(bitmap: Bitmap, faceBox: FaceBox): FloatArray {
        // Step 1: Aligned square face crop → 112x112
        val alignedCrop = ImageCropUtils.getAlignedFaceCrop(bitmap, faceBox, 112, 112)

        // Step 2: Pack as RGB, float32, divide by 255, NCHW
        val tensor = TensorPacker.packForMobileFaceNet(alignedCrop)

        // Step 3: Run inference
        val output = Array(1) { FloatArray(embeddingSize) }
        interpreter.run(tensor, output)

        // Step 4 & 5: L2 normalize the embedding
        return MathUtils.l2Normalize(output[0])
    }

    /**
     * Extracts an embedding from an already-cropped and aligned 112x112 face bitmap.
     * Used during registration augmentations.
     */
    fun extractEmbeddingFromCrop(croppedBitmap: Bitmap): FloatArray {
        // Pack as RGB, float32, divide by 255, NCHW
        val tensor = TensorPacker.packForMobileFaceNet(croppedBitmap)

        // Run inference
        val output = Array(1) { FloatArray(embeddingSize) }
        interpreter.run(tensor, output)

        // L2 normalize the embedding
        return MathUtils.l2Normalize(output[0])
    }

    /**
     * Matches an embedding against a database of stored embeddings.
     *
     * Python equivalent (test_pipeline.py lines 236-244):
     *   match = face_net.match(embedding, enrolled_embeddings)
     *
     * @return MatchResult with the best match user ID and cosine score
     */
    fun match(
        currentEmbedding: FloatArray,
        storedEmbeddings: Map<String, FloatArray>,
        threshold: Float = 0.4f
    ): MatchResult {
        var bestScore = -1.0f
        var bestUserId: String? = null

        for ((userId, storedEmbedding) in storedEmbeddings) {
            val score = MathUtils.cosineSimilarity(currentEmbedding, storedEmbedding)
            if (score > bestScore) {
                bestScore = score
                bestUserId = userId
            }
        }

        val matched = bestScore >= threshold
        return MatchResult(
            matched = matched,
            matchedUserId = if (matched) bestUserId else null,
            recognitionScore = bestScore
        )
    }

    fun close() {
        interpreter.close()
    }

    data class MatchResult(
        val matched: Boolean,
        val matchedUserId: String?,
        val recognitionScore: Float
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
