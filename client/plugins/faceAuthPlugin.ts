/**
 * faceAuthPlugin.ts
 *
 * React Native bridge to the native CameraX-based face authentication view.
 *
 * Usage in a screen:
 *
 *   import { CameraXView, FaceAuthResult, requestCameraPermission } from '../plugins/faceAuthPlugin';
 *
 *   <CameraXView
 *     style={StyleSheet.absoluteFill}
 *     mode="attendance"
 *     isActive={true}
 *     onFaceAuthResult={(e) => handleResult(e.nativeEvent)}
 *   />
 */

import {
  requireNativeComponent,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import type { ViewProps } from 'react-native';

// ── Result type (unchanged from the VisionCamera version) ──

export type FaceAuthResult = {
  status: 'ACCEPT' | 'REJECT' | 'RETRY' | 'EMBEDDING' | 'ERROR';
  decision?: string;
  reason: string;
  faceDetected?: boolean;
  frameProcessed?: boolean;
  isLive?: boolean | null;
  liveScore?: number | null;
  spoofScore?: number | null;
  screenScore?: number | null;
  fusedSpoofScore?: number | null;
  qualityPassed?: boolean;
  faceSizeOk?: boolean;
  faceCentered?: boolean;
  lightingGood?: boolean;
  eyesVisible?: boolean;
  blinkDetected?: boolean;
  smileDetected?: boolean;
  headTurnDetected?: boolean;
  matchedUserId?: string | null;
  recognitionScore?: number | null;
  embedding?: number[];
  faceBase64?: string;
  liveness?: {
    livenessPass: boolean;
  };
};

// ── Native Component Props ──

export interface CameraXViewProps extends ViewProps {
  mode: 'registration' | 'attendance';
  isActive: boolean;
  isCaptureRequested?: boolean;
  onFaceAuthResult?: (event: { nativeEvent: FaceAuthResult }) => void;
}

// ── Native Component ──

export const CameraXView =
  requireNativeComponent<CameraXViewProps>('CameraXView');

// ── Permission Helper ──

export async function requestCameraPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA,
      {
        title: 'Camera Permission',
        message: 'FaceField needs camera access for face authentication.',
        buttonPositive: 'OK',
        buttonNegative: 'Cancel',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }
  return true;
}
