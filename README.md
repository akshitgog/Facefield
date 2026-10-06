# FaceField

Offline-first facial recognition and liveness detection attendance system designed for reliable workforce management without active internet connectivity.

---

## 📱 Quick Start & Installation

To install and test the application on an Android device:

1. Download the pre-built **`app-release.apk`** from the [GitHub Releases](https://github.com/akshitgog/Facefield/releases) section.
2. Open your device's **File Manager** and tap `app-release.apk` to install.
3. Open the app and proceed through the registration/login flow.
4. Complete your one-time face registration in good lighting, then test attendance marking.

---

## 💻 Local Setup & Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Run on Android
```bash
npx react-native run-android
```

---

## 📁 Repository Structure & Documentation

Detailed technical documentation is modularized within each subfolder:

- **[`/frontend`](file:///C:/Users/Galactus/OneDrive/Desktop/FaceField/frontend/README.md)**: React Native screens, Zustand state management, navigation stacks, and UI components.
- **[`/android`](file:///C:/Users/Galactus/OneDrive/Desktop/FaceField/android/README.md)**: Native CameraX pipeline, MediaPipe & TensorFlow Lite model integration, active/passive liveness detection, and native build scripts.
- **[`docs/aws_integration.md`](file:///C:/Users/Galactus/OneDrive/Desktop/FaceField/docs/aws_integration.md)**: Specifications for AWS synchronization and data purging mechanisms.
- **[`scripts/RELEASE.md`](file:///C:/Users/Galactus/OneDrive/Desktop/FaceField/scripts/RELEASE.md)**: Guide for configuring keystores and generating release builds.
