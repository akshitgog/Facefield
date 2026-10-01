package com.datalakeauth.plugin

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.Promise
import com.datalakeauth.utils.SecureData
import org.json.JSONObject

class FaceAuthModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val dbHelper = EmbeddingDatabaseHelper.getInstance(reactContext)

    override fun getName(): String {
        return "FaceAuthSQLite"
    }

    @ReactMethod
    fun saveEmbedding(userId: String, embeddingArray: ReadableArray, promise: Promise) {
        try {
            require(userId.isNotBlank()) { "Missing user ID" }
            require(embeddingArray.size() > 0) { "Empty embedding" }
            val floatArray = FloatArray(embeddingArray.size())
            for (i in 0 until embeddingArray.size()) {
                floatArray[i] = embeddingArray.getDouble(i).toFloat()
                require(floatArray[i].isFinite()) { "Invalid embedding" }
            }
            dbHelper.saveEmbedding(userId, floatArray)
            android.util.Log.d("FaceAuth", "SAVE_EMBEDDING_SUCCESS")
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SAVE_FAILED", "Failed to store face embedding", e)
        }
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

    @ReactMethod
    fun saveRegisteredUser(userJson: String, promise: Promise) {
        try {
            val user = JSONObject(userJson)
            val userId = user.getString("userId")
            require(userId.isNotBlank())
            val values = user.getJSONArray("embedding")
            require(values.length() > 0)
            val embedding = FloatArray(values.length()) { values.getDouble(it).toFloat() }
            require(embedding.all { it.isFinite() })
            dbHelper.saveRegisteredUser(userId, embedding, userJson)
            android.util.Log.d("FaceAuth", "SAVE_EMBEDDING_SUCCESS")
            promise.resolve(true)
        } catch (e: Exception) { promise.reject("SAVE_FAILED", "Failed to store face enrollment", e) }
    }

    @ReactMethod
    fun getRegisteredUsers(promise: Promise) {
        try { promise.resolve(dbHelper.getRegisteredUsers()) }
        catch (e: Exception) {
            // SQLite diagnostics contain schema/engine errors, not bound biometric values.
            if (e is android.database.sqlite.SQLiteException) android.util.Log.e("FaceFieldStorage", "SQLite enrollment read failed: ${e.message}")
            else android.util.Log.e("FaceFieldStorage", "Enrollment read failed: ${e.javaClass.simpleName}")
            promise.reject("READ_FAILED", "Failed to read face enrollments", e)
        }
    }

    @ReactMethod
    fun encryptString(value: String, purpose: String, promise: Promise) {
        try { promise.resolve(SecureData.encrypt(value, purpose)) }
        catch (e: Exception) { promise.reject("ENCRYPT_FAILED", "Cannot protect local data", e) }
    }

    @ReactMethod
    fun decryptString(value: String, purpose: String, promise: Promise) {
        try { promise.resolve(SecureData.decrypt(value, purpose)) }
        catch (e: Exception) { promise.reject("DECRYPT_FAILED", "Cannot read protected local data", e) }
    }

    @ReactMethod
    fun hashSecret(value: String, promise: Promise) {
        try { promise.resolve(SecureData.hashSecret(value)) }
        catch (e: Exception) { promise.reject("HASH_FAILED", "Cannot protect credentials", e) }
    }

    @ReactMethod
    fun verifySecret(value: String, encoded: String, promise: Promise) {
        try { promise.resolve(SecureData.verifySecret(value, encoded)) }
        catch (e: Exception) { promise.reject("VERIFY_FAILED", "Cannot verify credentials", e) }
    }
}
