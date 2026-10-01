# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# FaceField / DatalakeAuth Native Plugin & Models
-keep class com.datalakeauth.** { *; }

# TensorFlow Lite & LiteRT
-keep class org.tensorflow.lite.** { *; }
-keep class com.google.ai.edge.litert.** { *; }

# MediaPipe Vision Tasks
-keep class com.google.mediapipe.** { *; }
