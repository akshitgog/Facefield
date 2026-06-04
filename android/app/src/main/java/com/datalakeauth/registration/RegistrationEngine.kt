package com.datalakeauth.registration

import android.content.Context
import android.graphics.Bitmap
import com.datalakeauth.models.FaceNetEngine
import com.datalakeauth.preprocessing.ImageCropUtils
import com.datalakeauth.preprocessing.ImageCropUtils.FaceBox
import com.datalakeauth.utils.MathUtils

/**
 * Registration Engine — handles the full face enrollment pipeline.
 *
 * Flow from mobile_implementation_strategy.md:
 *   Capture Face → Quality Check → Liveness Check →
 *   Face Alignment → Crop + Resize (112×112) →
 *   Augmentation (5 variants) → MobileFaceNet (5 embeddings) →
 *   Average Embedding → L2 Normalize → Store Locally
 *
 * This is intentionally kept simple — the augmentations are just
 * slight brightness/contrast/rotation tweaks, not advanced transforms.
 */
class RegistrationEngine(context: Context) {

    private val faceNetEngine = FaceNetEngine(context)

    /**
     * Generates a robust face embedding from a single captured frame.
     *
     * Steps:
     *   1. Align and crop face to 112×112
     *   2. Generate 5 augmented variants (original + 4 tweaks)
     *   3. Run MobileFaceNet on each → 5 embeddings
     *   4. Average the 5 embeddings
     *   5. L2 normalize the average
     *
     * @param bitmap   The full camera frame
     * @param faceBox  The detected face bounding box
     * @return L2-normalized average embedding (FloatArray)
     */
    fun generateRobustEmbedding(bitmap: Bitmap, faceBox: FaceBox): FloatArray {
        // Step 1: Aligned square face crop → 112×112
        val alignedCrop = ImageCropUtils.getAlignedFaceCrop(bitmap, faceBox, 112, 112)

        // Step 2: Generate 5 variants
        val variants: List<Bitmap> = SimpleAugmentation.generateVariants(alignedCrop)

        // Step 3: Extract embedding from each variant
        val embeddings: List<FloatArray> = variants.map { variant ->
            faceNetEngine.extractEmbeddingFromCrop(variant)
        }

        // Step 4: Average all embeddings
        val embeddingSize = embeddings[0].size
        val averageEmbedding = FloatArray(embeddingSize)
        for (embedding in embeddings) {
            for (i in embedding.indices) {
                averageEmbedding[i] += embedding[i]
            }
        }
        for (i in averageEmbedding.indices) {
            averageEmbedding[i] /= embeddings.size.toFloat()
        }

        // Step 5: L2 normalize
        return MathUtils.l2Normalize(averageEmbedding)
    }

    fun close() {
        faceNetEngine.close()
    }
}
