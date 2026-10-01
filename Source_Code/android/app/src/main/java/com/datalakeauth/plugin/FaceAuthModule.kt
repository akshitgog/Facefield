package com.datalakeauth.plugin

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.Promise

class FaceAuthModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val dbHelper = EmbeddingDatabaseHelper(reactContext)

    override fun getName(): String {
        return "FaceAuthSQLite"
    }

    @ReactMethod
    fun saveEmbedding(userId: String, embeddingArray: ReadableArray) {
        val floatArray = FloatArray(embeddingArray.size())
        for (i in 0 until embeddingArray.size()) {
            floatArray[i] = embeddingArray.getDouble(i).toFloat()
        }
        android.util.Log.d("FaceAuth", "SAVE_EMBEDDING userId=$userId size=${floatArray.size}")
        dbHelper.saveEmbedding(userId, floatArray)
        android.util.Log.d("FaceAuth", "SAVE_EMBEDDING_SUCCESS userId=$userId")
    }

    @ReactMethod
    fun deleteEmbedding(userId: String, promise: Promise) {
        try {
            dbHelper.deleteEmbedding(userId)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("DELETE_FAILED", "Failed to delete embedding for user $userId", e)
        }
    }
}
