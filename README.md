# Datalake 3.0 - Offline Facial Recognition & Liveness Detection

This project was developed for the Hackathon to provide a highly accurate, lightweight, and entirely offline facial recognition attendance system for remote locations.

## 🚀 Key Achievements
- **Offline First**: Works with zero network connectivity. Uses local SQLite and AsyncStorage.
- **Micro AI Footprint**: Achieved an AI model footprint of just **6.04 MB** using Dynamic Range Quantization (DRQ), successfully beating the 20 MB requirement.
- **Zero-Latency Native Processing**: Bypassed the React Native bridge by implementing computer vision processing purely in C++ JSI and Kotlin `react-native-worklets-core`.
- **Dual-Layer Liveness Detection**:
  - **Passive Liveness**: 2 Neural Networks analyzing moiré patterns/textures to detect printed photos and digital screens.
  - **Active Liveness**: Real-time 3D tracking of 468 facial landmarks to detect blinks, smiles, and head turns.

## 📦 System Architecture
1. **Frontend**: React Native, Zustand (State Management), React Navigation.
2. **Camera API**: `react-native-vision-camera` (v4).
3. **Native ML**: TensorFlow Lite C++ API, MediaPipe Tasks Vision.
4. **Offline Database**: Android SQLite OpenHelper.

## 🔧 Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Android Application
```bash
npx react-native run-android
```

*(Note: The AI Models are bundled directly into the `android/app/src/main/assets/` directory.)*

## 📁 Repository Structure
- `/client` - React Native UI, Navigation, and Zustand State.
- `/android/app/src/main/java/com/datalakeauth` - Custom Kotlin/C++ Native modules for ML pipelines, Liveness, and Registration.
- `/android/app/src/main/assets` - TFLite Models.
- `AWS_INTEGRATION.md` - Documentation outlining the Sync & Purge mechanism.
