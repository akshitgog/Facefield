# Android Native Module (`com.datalakeauth`)

This directory contains the custom native Android implementation powering FaceField's offline facial recognition, liveness detection, and biometric matching.

---

## 🏗️ Architecture & Pipeline Overview

The native layer operates directly with camera frames via CameraX and processes computer vision pipelines on-device without network dependencies.

```
[CameraX Frame] 
      │
      ▼
[FaceAuthAnalyzer] ─── (Bounding Box, Sharpness & Face Size Checks)
      │
      ▼
[MediaPipe FaceMesh] ─── (468 3D Facial Landmarks)
      │
      ├───► [ActiveLivenessEngine] ─── (Blink EAR, Smile Ratio, Head Turn)
      │
      ├───► [SilentFace / Anti-Spoofing] ─── (Passive Moiré & Texture Analysis)
      │
      └───► [MobileFaceNet Engine] ─── (192-d Cosine Similarity Embedding, Match >= 0.65)
```

---

## 🧠 Machine Learning Models & Engines

All models are packaged locally under [`android/app/src/main/assets`](file:///C:/Users/Galactus/OneDrive/Desktop/FaceField/android/app/src/main/assets):

1. **MediaPipe Face Detection & FaceMesh**
   - **Model:** `face_detector.tflite`
   - Detects face presence, crops bounding boxes, and generates 468 3D landmark points in pixel coordinates.
   - Used for head pose estimation, smile detection, and eye aspect ratio (EAR) calculation.

2. **MobileFaceNet (Face Recognition)**
   - **Model:** `mobilefacenet_drq.tflite`
   - Quantized using Dynamic Range Quantization (DRQ) to run efficiently on mobile CPU.
   - Extracts compact embedding vectors from aligned, normalized face crops.
   - Compares vectors using cosine similarity with a matching threshold of **0.65**.

3. **SilentFace Anti-Spoofing (Passive Liveness)**
   - **Model:** `silentface_4_0_drq.tflite`
   - Evaluates frame textures to prevent physical spoofing attempts (e.g. printed photos, digital displays).

4. **Screen & Texture Spoof Detector**
   - Heuristic gradient, high-frequency texture, and Moiré pattern analysis to reject digital screens.

---

## 🧩 Directory Structure

- `app/src/main/java/com/datalakeauth/`:
  - `camerax/`: Custom CameraX view and frame analysis (`CameraXView.kt`, `FaceAuthAnalyzer.kt`).
  - `models/`: ML runtime wrappers for TensorFlow Lite and MediaPipe (`FaceNetEngine.kt`, `ActiveLivenessEngine.kt`, `SilentFaceEngine.kt`).
  - `plugin/`: Orchestration logic bridging camera events with React Native (`FaceAuthOrchestrator.kt`, `FaceAuthPlugin.kt`).
  - `preprocessing/`: Alignment, image scaling, and NHWC tensor packing (`TensorPacker.kt`, `FaceQualityChecker.kt`).
  - `storage/`: Local SQLite storage for face templates and enrollment records (`DatabaseHelper.kt`).
- `app/src/main/assets/`: Quantized TFLite models and MediaPipe assets.

---

## 🛠️ Building the Native App

### Prerequisites
- JDK 17
- Android SDK (API 34, Build Tools 34.0.0)
- NDK & CMake configured

### Debug Build
```bash
cd android
./gradlew assembleDebug
```
Output: `app/build/outputs/apk/debug/app-debug.apk`

### Release Build
To build a signed release APK using protected signing keys:
```bash
pwsh -NoProfile -File scripts/build-release.ps1
```
Output: `app/build/outputs/apk/release/app-release.apk`
