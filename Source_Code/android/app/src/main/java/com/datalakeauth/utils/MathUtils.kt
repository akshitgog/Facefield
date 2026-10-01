package com.datalakeauth.utils

import kotlin.math.sqrt

/**
 * Pure math utilities for the face authentication pipeline.
 *
 * Python reference: test_pipeline.py — np.dot / cosine matching logic.
 */
object MathUtils {

    /**
     * Cosine similarity between two embedding vectors.
     *
     * Python equivalent:
     *   dot = np.dot(A, B)
     *   cosine = dot / (np.linalg.norm(A) * np.linalg.norm(B))
     */
    fun cosineSimilarity(a: FloatArray, b: FloatArray): Float {
        require(a.size == b.size) { "Embedding dimensions must match: ${a.size} vs ${b.size}" }
        var dotProduct = 0.0f
        var normA = 0.0f
        var normB = 0.0f
        for (i in a.indices) {
            dotProduct += a[i] * b[i]
            normA += a[i] * a[i]
            normB += b[i] * b[i]
        }
        val denominator = sqrt(normA) * sqrt(normB)
        if (denominator == 0.0f) return 0.0f
        return dotProduct / denominator
    }

    /**
     * L2-normalize an embedding vector in-place.
     *
     * Python equivalent:
     *   embedding = embedding / np.linalg.norm(embedding)
     */
    fun l2Normalize(embedding: FloatArray): FloatArray {
        var sumSquares = 0.0f
        for (v in embedding) {
            sumSquares += v * v
        }
        val norm = sqrt(sumSquares)
        if (norm == 0.0f) return embedding
        val result = FloatArray(embedding.size)
        for (i in embedding.indices) {
            result[i] = embedding[i] / norm
        }
        return result
    }

    /**
     * Euclidean distance between two 2D points.
     *
     * Python equivalent (quality.py line 177-178):
     *   float(np.linalg.norm(a - b))
     */
    fun distance(ax: Float, ay: Float, bx: Float, by: Float): Float {
        val dx = ax - bx
        val dy = ay - by
        return sqrt(dx * dx + dy * dy)
    }

    /**
     * Softmax over a float array.
     *
     * Used by SilentFace to convert raw logits to probabilities.
     */
    fun softmax(logits: FloatArray): FloatArray {
        val maxVal = logits.max()
        val exps = FloatArray(logits.size) { kotlin.math.exp(logits[it] - maxVal) }
        val sumExps = exps.sum()
        return FloatArray(logits.size) { exps[it] / sumExps }
    }
}
