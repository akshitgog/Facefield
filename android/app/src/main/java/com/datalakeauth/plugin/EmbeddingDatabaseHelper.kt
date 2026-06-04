package com.datalakeauth.plugin

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray

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
class EmbeddingDatabaseHelper(context: Context) : SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {

    companion object {
        private const val DATABASE_NAME = "DatalakeAuth.db"
        private const val DATABASE_VERSION = 1

        const val TABLE_EMBEDDINGS = "embeddings"
        const val COLUMN_USER_ID = "user_id"
        const val COLUMN_EMBEDDING = "embedding_json"

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
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS $TABLE_EMBEDDINGS")
        onCreate(db)
    }

    /**
     * Saves or updates a user's embedding.
     * @param userId The unique ID of the user
     * @param embedding The L2-normalized float array
     */
    fun saveEmbedding(userId: String, embedding: FloatArray) {
        val db = this.writableDatabase
        
        // Convert FloatArray to JSON string for easy SQLite storage
        val jsonArray = JSONArray()
        embedding.forEach { jsonArray.put(it.toDouble()) }

        val values = ContentValues().apply {
            put(COLUMN_USER_ID, userId)
            put(COLUMN_EMBEDDING, jsonArray.toString())
        }

        db.insertWithOnConflict(
            TABLE_EMBEDDINGS,
            null,
            values,
            SQLiteDatabase.CONFLICT_REPLACE
        )
        db.close()
        
        // Invalidate cache so the next frame reloads the new user
        cachedEmbeddings = null
    }

    /**
     * Retrieves all stored embeddings for the recognition engine to match against.
     * @return Map of userId -> embedding array
     */
    fun getAllEmbeddings(): Map<String, FloatArray> {
        // Return memory cache instantly if available
        val currentCache = cachedEmbeddings
        if (currentCache != null) {
            return currentCache
        }

        val db = this.readableDatabase
        val embeddingsMap = mutableMapOf<String, FloatArray>()
        
        val cursor = db.rawQuery("SELECT * FROM $TABLE_EMBEDDINGS", null)
        
        if (cursor.moveToFirst()) {
            do {
                val userId = cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_USER_ID))
                val embeddingJson = cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_EMBEDDING))
                
                // Parse JSON array back to FloatArray
                val jsonArray = JSONArray(embeddingJson)
                val floatArray = FloatArray(jsonArray.length())
                for (i in 0 until jsonArray.length()) {
                    floatArray[i] = jsonArray.getDouble(i).toFloat()
                }
                
                embeddingsMap[userId] = floatArray
            } while (cursor.moveToNext())
        }
        cursor.close()
        db.close()
        
        // Store in volatile memory cache for future frames
        cachedEmbeddings = embeddingsMap
        return embeddingsMap
    }
    
    /**
     * Deletes a user's embedding.
     */
    fun deleteEmbedding(userId: String) {
        val db = this.writableDatabase
        db.delete(TABLE_EMBEDDINGS, "$COLUMN_USER_ID = ?", arrayOf(userId))
        db.close()
        
        cachedEmbeddings = null
    }
    
    /**
     * Clears the entire database (useful for AWS sync & purge demo)
     */
    fun purgeAll() {
        val db = this.writableDatabase
        db.delete(TABLE_EMBEDDINGS, null, null)
        db.close()
        
        cachedEmbeddings = null
    }
}
