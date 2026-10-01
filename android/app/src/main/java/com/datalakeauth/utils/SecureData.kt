package com.datalakeauth.utils

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec

/** Authenticated encryption with a non-exportable, app-scoped Android Keystore key. */
object SecureData {
    private const val ALIAS = "FaceField.LocalData.v1"
    const val PREFIX = "ffenc1:"

    @Synchronized
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build())
            generateKey()
        }
    }

    fun encrypt(value: String, purpose: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(purpose.toByteArray(Charsets.UTF_8))
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return PREFIX + Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(encrypted, Base64.NO_WRAP)
    }

    fun decrypt(value: String, purpose: String): String {
        require(value.startsWith(PREFIX)) { "Unsupported encrypted data format" }
        val parts = value.removePrefix(PREFIX).split(':')
        require(parts.size == 2)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
        cipher.updateAAD(purpose.toByteArray(Charsets.UTF_8))
        return String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8)
    }

    fun hashSecret(value: String): String {
        val algorithm = if (Build.VERSION.SDK_INT >= 26) "PBKDF2WithHmacSHA256" else "PBKDF2WithHmacSHA1"
        val iterations = if (Build.VERSION.SDK_INT >= 26) 600_000 else 1_300_000
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val hash = derive(value, salt, iterations, algorithm)
        return listOf("ffpbkdf2", algorithm, iterations.toString(),
            Base64.encodeToString(salt, Base64.NO_WRAP), Base64.encodeToString(hash, Base64.NO_WRAP)).joinToString(":")
    }

    fun verifySecret(value: String, encoded: String): Boolean {
        val parts = encoded.split(':')
        if (parts.size != 5 || parts[0] != "ffpbkdf2") return false
        if (parts[1] !in listOf("PBKDF2WithHmacSHA256", "PBKDF2WithHmacSHA1")) return false
        val iterations = parts[2].toIntOrNull() ?: return false
        if (iterations !in 100_000..1_500_000) return false
        val salt = Base64.decode(parts[3], Base64.NO_WRAP)
        val expected = Base64.decode(parts[4], Base64.NO_WRAP)
        if (salt.size != 16 || expected.size != 32) return false
        return MessageDigest.isEqual(expected, derive(value, salt, iterations, parts[1]))
    }

    private fun derive(value: String, salt: ByteArray, iterations: Int, algorithm: String): ByteArray {
        val spec = PBEKeySpec(value.toCharArray(), salt, iterations, 256)
        return try { SecretKeyFactory.getInstance(algorithm).generateSecret(spec).encoded }
        finally { spec.clearPassword() }
    }
}
