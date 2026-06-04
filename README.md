# FieldAttend — Offline Facial Recognition Attendance App

## Setup

```bash
npm install
# iOS
cd ios && pod install && cd ..
npx react-native run-ios

# Android
npx react-native run-android
```

## Architecture

```
App.tsx
└── SafeAreaProvider
    └── RootNavigator
        ├── AuthStack (not logged in)
        │   ├── LoginScreen
        │   ├── SignupScreen
        │   └── FaceRegistrationScreen
        └── App (logged in)
            ├── AppTabs (bottom tab)
            │   ├── DashboardScreen
            │   ├── HistoryScreen
            │   └── ProfileScreen
            ├── AttendanceVerificationScreen  (fullscreen modal)
            └── AttendanceSuccessScreen       (modal)
```

## Key Integration Points

### Vision Camera (Face Detection)
Replace placeholder `<View style={styles.camera}>` in:
- `FaceRegistrationScreen.tsx` — capture face embedding
- `AttendanceVerificationScreen.tsx` — run liveness + recognition

```tsx
import { Camera, useCameraDevice, useFrameProcessor } from 'react-native-vision-camera';
import { Face, useFaceDetector } from 'react-native-vision-camera-face-detector';

const device = useCameraDevice('front');
const { detectFaces } = useFaceDetector();

const frameProcessor = useFrameProcessor((frame) => {
  'worklet';
  const faces = detectFaces(frame);
  // Check: faces.length === 1, face.bounds, face.leftEyeOpenProbability, etc.
}, []);
```

### Offline Storage
- Attendance records: persisted via Zustand + AsyncStorage
- Face embeddings: store as base64 via `react-native-fs` in app documents directory
- Sync queue: implement background sync when network detected via `@react-native-community/netinfo`

### Liveness Detection Sequence
`AttendanceVerificationScreen` simulates the 3-step liveness check.
Wire each step to Vision Camera frame processor outputs:
1. Blink → `face.leftEyeOpenProbability < 0.15 && face.rightEyeOpenProbability < 0.15`
2. Smile → `face.smilingProbability > 0.8`  
3. Head turn → `Math.abs(face.yawAngle) > 25`

## Design Tokens (src/theme/index.ts)
| Token | Value |
|-------|-------|
| Primary | `#1A73E8` |
| Success | `#1E8F4E` |
| Error | `#D32F2F` |
| Border radius (card) | `16px` |
| Border radius (input) | `8px` |
| Min touch target | `48×48px` |
| Base font scale | `375px` viewport |
