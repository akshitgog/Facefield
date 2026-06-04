/**
 * faceAuthPlugin.ts
 *
 * React Native bridge to the native Kotlin FaceAuthFrameProcessorPlugin.
 *
 * Usage in a screen:
 *
 *   import { useFaceAuth } from '../plugins/faceAuthPlugin';
 *
 *   const { frameProcessor } = useFaceAuth({
 *     mode: 'attendance',
 *     onResult: (result) => {
 *       if (result.status === 'ACCEPT') markAttendance(result);
 *     }
 *   });
 *
 *   <Camera frameProcessor={frameProcessor} />
 */

import { VisionCameraProxy, Frame, useFrameProcessor, FrameProcessorPlugin } from 'react-native-vision-camera';
import { useSharedValue, Worklets } from 'react-native-worklets-core';

// Register the native plugin
let plugin: FrameProcessorPlugin | undefined;

/**
 * Calls the native faceAuth plugin on a single frame.
 */
export function faceAuth(frame: Frame, params?: Record<string, unknown>): FaceAuthResult {
  'worklet';
  if (plugin == null) {
    plugin = VisionCameraProxy.initFrameProcessorPlugin('faceAuth', {});
  }
  if (plugin == null) {
    throw new Error('faceAuth plugin not found.');
  }
  return plugin.call(frame, params as any) as unknown as FaceAuthResult;
}

export type FaceAuthResult = {
  status: 'ACCEPT' | 'REJECT' | 'RETRY' | 'EMBEDDING';
  decision?: string;
  reason: string;
  faceDetected?: boolean;
  isLive?: boolean;
  liveScore?: number;
  spoofScore?: number;
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
};

type UseFaceAuthOptions = {
  mode: 'attendance' | 'registration';
  onResult: (result: FaceAuthResult) => void;
  throttleMs?: number;
};

export function useFaceAuth({ mode, onResult, throttleMs = 500 }: UseFaceAuthOptions) {
  const lastRunTime = useSharedValue(0);
  const isProcessing = useSharedValue(false);

  const runOnJSResult = Worklets.createRunInJsFn(onResult);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';

      // Throttle: skip if we ran the heavy pipeline too recently
      const now = Date.now();
      if (now - lastRunTime.value < throttleMs) return;
      if (isProcessing.value) return;

      isProcessing.value = true;
      lastRunTime.value = now;

      try {
        const result = faceAuth(frame, { mode });

        if (result.status !== 'RETRY' || result.faceDetected) {
          // Send result back to JS thread using JS call
          // Worklets allows calling JS functions if they are captured
          runOnJSResult(result);
        }
      } finally {
        isProcessing.value = false;
      }
    },
    [mode, runOnJSResult, throttleMs]
  );

  return { frameProcessor };
}
