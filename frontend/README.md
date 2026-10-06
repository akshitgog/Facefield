# FaceField Frontend (`/frontend`)

This directory contains the user interface, navigation, state stores, and local persistence layer for the FaceField application built with React Native and TypeScript.

---

## 📱 Architecture & Module Organization

The frontend codebase is organized into modular layers:

```
frontend/
├── assets/          # Static assets, branding, and images
├── components/      # Reusable UI primitives (Button, Card, StatusBadge, TextInput)
├── navigation/      # Navigation hierarchies (RootNavigator, AuthStack, AppTabs)
├── plugins/         # Native module bridge interfaces (faceAuthPlugin.ts)
├── screens/         # Application screens organized by feature domain
│   ├── attendance/  # Verification & confirmation screens
│   ├── auth/        # Sign-in, sign-up, and face registration workflows
│   ├── dashboard/   # Main summary and quick-action view
│   ├── history/     # Historical attendance log listing
│   └── profile/     # User information and credentials
├── store/           # Zustand state management and local storage abstractions
└── theme/           # Color palettes, spacing, and typography tokens
```

---

## 🔄 State Management & Storage

- **Zustand (`store/`):**
  - `useUserStore`: Manages authenticated session, employee registration state, and enrolled biometric references.
  - `useAttendanceStore`: Manages daily check-ins, timestamps, verification statuses, and sync state.
- **Local Persistence (`store/secureStorage.ts`, `store/embeddingStorage.ts`):**
  - Encrypted key-value storage for sensitive sessions and biometric templates.
  - Offline-first reconciliation engine ensuring biometric records and attendance events survive process restarts and device power-offs.

---

## 🚀 Navigation Flows

1. **Authentication Flow (`navigation/AuthStack.tsx`):**
   - `LoginScreen` ➡️ Standard credential authentication.
   - `SignupScreen` ➡️ New employee onboarding.
   - `FaceRegistrationScreen` ➡️ CameraX-powered facial capture and local embedding generation.
   - `ForgotPasswordScreen` ➡️ Account recovery flow.

2. **Main Application Flow (`navigation/AppTabs.tsx`):**
   - `DashboardScreen`: Overview of current status, shift timings, and verification triggers.
   - `AttendanceVerificationScreen`: Live facial matching against stored local templates.
   - `AttendanceSuccessScreen`: Visual confirmation of recorded attendance.
   - `HistoryScreen`: Searchable list of past check-ins/check-outs.
   - `ProfileScreen`: Profile management and account details.

---

## 💻 Development & Running

### Install Dependencies
From the repository root:
```bash
npm install
```

### Start Metro Bundler
```bash
npm start
```

### Launch on Android
```bash
npx react-native run-android
```
