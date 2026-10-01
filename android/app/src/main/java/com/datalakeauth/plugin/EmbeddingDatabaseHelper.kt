package com.datalakeauth.plugin

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject
import com.datalakeauth.utils.SecureData

/**
 * Local SQLite database for storing User Face Embeddings natively.
 *
 * Why native SQLite instead of React Native AsyncStorage?
 * Because the Kotlin AI pipeline needs to perform Cosine Similarity matching
 * against ALL registered users at 30 frames per second. Passing huge embedding
 * arrays from JS to Native on every frame would crash the app.
 *
 * This allows the Native Orchestrator to instantly pull embeddings.
 */
class EmbeddingDatabaseHelper private constructor(context: Context) : SQLiteOpenHelper(context.applicationContext, DATABASE_NAME, null, DATABASE_VERSION) {

    companion object {
        private const val DATABASE_NAME = "DatalakeAuth.db"
        private const val DATABASE_VERSION = 2

        const val TABLE_EMBEDDINGS = "embeddings"
        const val COLUMN_USER_ID = "user_id"
        const val COLUMN_EMBEDDING = "embedding_json"

        @Volatile
        private var instance: EmbeddingDatabaseHelper? = null

        fun getInstance(context: Context): EmbeddingDatabaseHelper {
            return instance ?: synchronized(this) {
                instance ?: EmbeddingDatabaseHelper(context.applicationContext).also { instance = it }
            }
        }

        // In-memory cache to prevent 30 FPS SQLite I/O locking
        @Volatile
        private var cachedEmbeddings: Map<String, FloatArray>? = null
    }

    override fun onCreate(db: SQLiteDatabase) {
        val createTable = """
            CREATE TABLE $TABLE_EMBEDDINGS (
                $COLUMN_USER_ID TEXT PRIMARY KEY,
                $COLUMN_EMBEDDING TEXT NOT NULL
            )
        """.trimIndent()
        db.execSQL(createTable)
        createUserTable(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        createUserTable(db)
        if (oldVersion < 2) {
            // SQLiteOpenHelper runs this inside a transaction; failed encryption rolls back.
            db.rawQuery("SELECT * FROM $TABLE_EMBEDDINGS", null).use { cursor ->
                while (cursor.moveToNext()) {
                    val userId = cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_USER_ID))
                    val raw = cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_EMBEDDING))
                    if (!raw.startsWith(SecureData.PREFIX)) {
                        val values = ContentValues().apply {
                            put(COLUMN_EMBEDDING, SecureData.encrypt(raw, "embedding:$userId"))
                        }
                        db.update(TABLE_EMBEDDINGS, values, "$COLUMN_USER_ID = ?", arrayOf(userId))
                    }
                }
            }
        }
    }

    private fun createUserTable(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS registered_users (user_id TEXT PRIMARY KEY, user_json TEXT NOT NULL)")
    }

    @Synchronized
    fun saveRegisteredUser(userId: String, embedding: FloatArray, userJson: String) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            saveEmbedding(userId, embedding)
            val values = ContentValues().apply {
                put("user_id", userId)
                put("user_json", SecureData.encrypt(userJson, "registered-user:$userId"))
            }
            check(db.insertWithOnConflict("registered_users", null, values, SQLiteDatabase.CONFLICT_REPLACE) != -1L)
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
            cachedEmbeddings = null
        }
    }

    @Synchronized
    fun getRegisteredUsers(): String {
        val result = JSONObject()
        readableDatabase.rawQuery("SELECT user_id, user_json FROM registered_users", null).use { cursor ->
            while (cursor.moveToNext()) {
                val userId = cursor.getString(0)
                result.put(userId, JSONObject(SecureData.decrypt(cursor.getString(1), "registered-user:$userId")))
            }
        }
        return result.toString()
    }

    override fun onConfigure(db: SQLiteDatabase) {
        super.onConfigure(db)
        // This PRAGMA returns a row; execSQL rejects result-producing statements.
        db.rawQuery("PRAGMA secure_delete=ON", null).use { cursor ->
            check(cursor.moveToFirst() && cursor.getInt(0) == 1) { "Could not enable SQLite secure deletion" }
        }
    }

    /**
     * Saves or updates a user's embedding.
     * @param userId The unique ID of the user
     * @param embedding The L2-normalized float array
     */
    @Synchronized
    fun saveEmbedding(userId: String, embedding: FloatArray) {
        val db = this.writableDatabase

        // Convert FloatArray to JSON string for easy SQLite storage
        val jsonArray = JSONArray()
        embedding.forEach { jsonArray.put(it.toDouble()) }

        val values = ContentValues().apply {
            put(COLUMN_USER_ID, userId)
            put(COLUMN_EMBEDDING, SecureData.encrypt(jsonArray.toString(), "embedding:$userId"))
        }

        val inserted = db.insertWithOnConflict(
            TABLE_EMBEDDINGS,
            null,
            values,
            SQLiteDatabase.CONFLICT_REPLACE
        )
        check(inserted != -1L) { "SQLite embedding write failed" }

        // Invalidate cache so the next frame reloads the new user
        cachedEmbeddings = null
    }

    /**
     * Retrieves all stored embeddings for the recognition engine to match against.
     * @return Map of userId -> embedding array
     */
    @Synchronized
    fun getAllEmbeddings(): Map<String, FloatArray> {
        // Return memory cache instantly if available
        val currentCache = cachedEmbeddings
        if (currentCache != null) {
            return currentCache
        }

        val db = this.readableDatabase
        val embeddingsMap = mutableMapOf<String, FloatArray>()

        db.rawQuery("SELECT * FROM $TABLE_EMBEDDINGS", null).use { cursor ->
            if (cursor.moveToFirst()) {
                do {
                    val userId = cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_USER_ID))
                    val embeddingJson = cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_EMBEDDING))

                    // Parse JSON array back to FloatArray
                    val jsonArray = JSONArray(SecureData.decrypt(embeddingJson, "embedding:$userId"))
                    val floatArray = FloatArray(jsonArray.length())
                    for (i in 0 until jsonArray.length()) {
                        floatArray[i] = jsonArray.getDouble(i).toFloat()
                    }

                    embeddingsMap[userId] = floatArray
                } while (cursor.moveToNext())
            }
        }

        // Store in volatile memory cache for future frames
        cachedEmbeddings = embeddingsMap
        return embeddingsMap
    }

    /**
     * Deletes a user's embedding.
     */
    @Synchronized
    fun deleteEmbedding(userId: String) {
        val db = this.writableDatabase
        db.beginTransaction()
        try {
            db.delete(TABLE_EMBEDDINGS, "$COLUMN_USER_ID = ?", arrayOf(userId))
            db.delete("registered_users", "user_id = ?", arrayOf(userId))
            db.setTransactionSuccessful()
        } finally { db.endTransaction(); cachedEmbeddings = null }
    }

    /**
     * Clears the entire database (useful for AWS sync & purge demo)
     */
    @Synchronized
    fun purgeAll() {
        val db = this.writableDatabase
        db.delete(TABLE_EMBEDDINGS, null, null)
        db.delete("registered_users", null, null)
        cachedEmbeddings = null
    }
}
