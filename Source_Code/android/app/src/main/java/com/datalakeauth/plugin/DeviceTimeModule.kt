package com.datalakeauth.plugin

import android.os.SystemClock
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class DeviceTimeModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "DeviceTime"
    }

    @ReactMethod
    fun getOfflineSecureTime(promise: Promise) {
        try {
            // Check if user has "Automatic Time" enabled in their Android Settings (Network/GPS time)
            val isAutoTime = Settings.Global.getInt(
                reactContext.contentResolver,
                Settings.Global.AUTO_TIME, 0
            ) == 1
            
            // Get the milliseconds since the phone was booted up
            // This CANNOT be faked by changing the clock in settings!
            val uptimeMillis = SystemClock.elapsedRealtime().toDouble()
            
            // Get current fakeable clock time just for formatting
            val currentTimeMillis = System.currentTimeMillis().toDouble()

            val map = com.facebook.react.bridge.Arguments.createMap()
            map.putBoolean("isAutoTimeEnabled", isAutoTime)
            map.putDouble("uptimeMillis", uptimeMillis)
            map.putDouble("currentTimeMillis", currentTimeMillis)
            
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("TIME_ERROR", e)
        }
    }
}
