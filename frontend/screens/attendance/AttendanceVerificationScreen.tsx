import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  StatusBar,
  TouchableOpacity,
  Alert,
  AppState,
  PermissionsAndroid,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaWrapper } from '../../components';
import { colors, spacing, typography, radius, fs } from '../../theme';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { useAttendanceStore, useUserStore } from '../../store';
import { CameraXView, FaceAuthResult } from '../../plugins/faceAuthPlugin';
import { saveAttendance } from '../../store/embeddingStorage';
import { localDateKey } from '../../store/localDate';

type Props = NativeStackScreenProps<RootStackParamList, 'AttendanceVerification'>;

export const AttendanceVerificationScreen: React.FC<Props> = ({ navigation }) => {
  const { user } = useUserStore();
  const [verifying, setVerifying] = useState(false);
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'verifying' | 'done'>('idle');
  const [feedbackMsg, setFeedbackMsg] = useState('Position your face in the oval.');
  const [indicators, setIndicators] = useState([
    { label: 'Face Detect', status: 'idle' },
    { label: 'Quality & Lighting', status: 'idle' },
    { label: 'Liveness (Blink/Smile)', status: 'idle' },
    { label: 'Anti-Spoof', status: 'idle' },
    { label: 'Face Recognition', status: 'idle' },
  ]);
  const { addRecord } = useAttendanceStore();

  const [hasPermission, setHasPermission] = useState(false);
  const [frameSeen, setFrameSeen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const acceptingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const isFocused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const activeRef = useRef(false);
  activeRef.current = isFocused && appActive;
  const lastFaceSeenTime = useRef<number>(Date.now());
  const scanStatusRef = useRef(scanStatus);
  scanStatusRef.current = scanStatus;
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => navigation.addListener('beforeRemove', () => {
    activeRef.current = false;
    scanStatusRef.current = 'idle';
  }), [navigation]);

  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        activeRef.current = false;
        scanStatusRef.current = 'idle';
        setScanStatus('idle');
      }
      setAppActive(state === 'active');
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsReady(true);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // Camera permission via standard PermissionsAndroid
  useEffect(() => {
    (async () => {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Permission',
          message: 'FaceField needs camera access for attendance verification.',
          buttonPositive: 'OK',
        }
      );
      setHasPermission(result === PermissionsAndroid.RESULTS.GRANTED);
    })();
  }, []);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    if (scanStatus === 'scanning') {
      timeoutId = setTimeout(() => {
        scanStatusRef.current = 'idle';
        setScanStatus('idle');
        setFeedbackMsg('Scan timed out. Please try again.');
        Alert.alert(
          'Timeout',
          'Verification took too long. Please ensure good lighting, look straight, and follow on-screen prompts.'
        );
      }, 15000); // 15 seconds timeout
    }
    return () => clearTimeout(timeoutId);
  }, [scanStatus]);

  // Stable callback using refs — no stale closures, no camera restarts
  const handleFaceResult = useCallback((event: { nativeEvent: FaceAuthResult }) => {
    if (!mountedRef.current || !activeRef.current) return;
    const result = event.nativeEvent;
    if (result.frameProcessed) setFrameSeen(true);
    if (result.status === 'ERROR') {
      scanStatusRef.current = 'idle';
      setScanStatus('idle');
      setCameraError(result.reason);
      return;
    }

    // Only process if we are actively scanning
    if (scanStatusRef.current !== 'scanning') {
      lastFaceSeenTime.current = Date.now();
      return;
    }

    if (result.faceDetected) {
      lastFaceSeenTime.current = Date.now();
    } else {
      if (Date.now() - lastFaceSeenTime.current > 4000) {
        scanStatusRef.current = 'idle';
        setScanStatus('idle');
        setFeedbackMsg('No face detected.');
        Alert.alert('Timeout', 'No face detected for 4 seconds. Please ensure your face is inside the oval.');
        return;
      }
    }

    let spoofStatus = 'idle';
    if (result.spoofScore !== undefined) {
      if (result.status === 'REJECT' && result.reason?.includes('Spoof')) {
        spoofStatus = 'error';
      } else if (result.isLive === true) {
        spoofStatus = 'ok';
      } else if (result.isLive === false) {
        spoofStatus = 'error';
      } else {
        spoofStatus = 'warn'; // Analyzing/Voting
      }
    }

    let livenessStatus = 'idle';
    if (result.liveness?.livenessPass || result.blinkDetected || result.smileDetected || result.headTurnDetected) {
      livenessStatus = 'ok';
    } else if (scanStatusRef.current === 'scanning') {
      livenessStatus = 'warn';
    }

    let recogStatus = 'idle';
    if (result.matchedUserId != null) {
      recogStatus = 'ok';
    } else if (result.status === 'REJECT' && result.reason?.includes('recognized')) {
      recogStatus = 'error';
    }

    // Update indicators
    setIndicators([
      { label: 'Face Detect', status: result.faceDetected ? 'ok' : 'error' },
      { label: 'Quality & Lighting', status: result.qualityPassed ? 'ok' : 'error' },
      { label: 'Liveness (Blink/Smile)', status: livenessStatus },
      { label: 'Spoof Check', status: spoofStatus },
      { label: 'Face Recognition', status: recogStatus },
    ]);

    if (result.status === 'RETRY') {
      if (result.reason) setFeedbackMsg(result.reason);
    }
    if (result.status === 'ACCEPT') {
      if (result.matchedUserId !== userRef.current?.id) {
        scanStatusRef.current = 'idle';
        setScanStatus('idle');
        setFeedbackMsg('Security Error: Face belongs to a different user.');
        Alert.alert('Identity Mismatch', 'This face does not match the logged-in account.');
        return;
      }

      // Only run this once to prevent multiple redirects during the delay
      if (scanStatusRef.current === 'scanning' && !acceptingRef.current) {
        acceptingRef.current = true;
        scanStatusRef.current = 'verifying';
        setScanStatus('verifying');
        setFeedbackMsg('Face verified successfully!');
        void handleVerified(result.matchedUserId!);
      }
    }
    if (result.status === 'REJECT') {
      scanStatusRef.current = 'idle';
      setScanStatus('idle');
      setFeedbackMsg(result.reason || 'Verification Failed');

      let title = 'Verification Failed';
      if (result.reason?.toLowerCase().includes('recognized')) {
        title = 'Unknown Identity';
      } else if (result.reason?.toLowerCase().includes('spoof')) {
        title = 'Spoof Detected';
      }
      Alert.alert(title, result.reason || 'Please try again.');
    }
  }, []);

  const handleVerified = async (userId: string) => {
    try {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const record = {
      id: `${userId}:${localDateKey(now)}`,
      date: localDateKey(now),
      entryTime: timeStr,
      userId: userId,
      status: 'present' as const,
      synced: false,
    };
    const savedRecord = await saveAttendance(record);
    addRecord(savedRecord);
    if (mountedRef.current && activeRef.current && userRef.current?.id === userId) {
      setScanStatus('done');
      navigation.replace('AttendanceSuccess', { record: savedRecord });
    }
    } catch {
      if (mountedRef.current) {
        acceptingRef.current = false;
        scanStatusRef.current = 'idle';
        setScanStatus('idle');
        setFeedbackMsg('Unable to save attendance. Please try again.');
        Alert.alert('Save Failed', 'Your attendance was not recorded. Please try again.');
      }
    }
  };

  const progress = scanStatus === 'idle' ? 0 : scanStatus === 'scanning' ? 0.5 : 1;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* Full-screen camera */}
      <View style={styles.camera}>
        {hasPermission && isReady ? (
          <CameraXView
            style={StyleSheet.absoluteFill}
            mode="attendance"
            isActive={isFocused && appActive && scanStatus === 'scanning' && !cameraError}
            onFaceAuthResult={handleFaceResult}
          />
        ) : (
          <View style={{ alignItems: 'center', justifyContent: 'center', flex: 1 }}>
            <Text style={styles.camPlaceholder}>Camera permission is required.</Text>
            <TouchableOpacity onPress={async () => {
              const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
              setHasPermission(result === PermissionsAndroid.RESULTS.GRANTED);
              if (result !== PermissionsAndroid.RESULTS.GRANTED) Alert.alert('Permission Required', 'Enable camera access in device settings.');
            }}><Text style={styles.camPlaceholder}>Grant Permission</Text></TouchableOpacity>
          </View>
        )}

        {/* Face oval guide — drawn on UI layer, does NOT affect model input */}
        <View style={styles.oval} pointerEvents="none" />

        {/* Cancel button */}
        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={() => {
            activeRef.current = false;
            scanStatusRef.current = 'idle';
            navigation.goBack();
          }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.cancelText}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom overlay panel */}
      <View style={styles.panel}>
          {frameSeen && !cameraError && <Text testID="camera-analysis-ready">Camera ready</Text>}
          {cameraError && <Text testID="camera-error">{cameraError}</Text>}
        {/* Progress bar */}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>

        {scanStatus === 'verifying' || scanStatus === 'done' ? (
          <View style={styles.verifyingRow}>
            <Text style={styles.verifyingText}>Verifying identity…</Text>
          </View>
        ) : scanStatus === 'scanning' ? (
          <View style={styles.livenessContainer}>
            <Text style={styles.panelTitle}>AI Analysis</Text>

            <View style={styles.checksContainer}>
              {indicators.map((ind, i) => {
                let icon = '⚪';
                let textColor = colors.textSecondary;
                let activeStyle = {};

                if (ind.status === 'ok') {
                  icon = '🟢';
                  activeStyle = styles.checkTextActive;
                } else if (ind.status === 'warn') {
                  icon = '🟠';
                  activeStyle = { color: colors.warning, fontWeight: '600' as const };
                } else if (ind.status === 'error') {
                  icon = '🔴';
                  activeStyle = { color: colors.error, fontWeight: '600' as const };
                }

                return (
                  <View key={i} style={styles.checkRow}>
                    <Text style={styles.checkIcon}>{icon}</Text>
                    <Text style={[styles.checkText, activeStyle]}>
                      {ind.label}
                    </Text>
                  </View>
                );
              })}
            </View>

            <View style={styles.feedbackBox}>
              <Text style={styles.feedbackText}>{feedbackMsg}</Text>
            </View>

            <View style={styles.scanningBadge}>
              <Text style={styles.scanningText}>⚡ Live Scanning...</Text>
            </View>
          </View>
        ) : (
          <View style={styles.livenessContainer}>
            <Text style={styles.panelTitle}>Ready to Scan</Text>
            <Text style={styles.panelSub}>
              Position your face in the oval and tap Start.
            </Text>
            <TouchableOpacity
              style={styles.startBtn}
              onPress={() => {
                if (!hasPermission) return;
                acceptingRef.current = false;
                lastFaceSeenTime.current = Date.now();
                scanStatusRef.current = 'scanning';
                setCameraError(null);
                setFrameSeen(false);
                setScanStatus('scanning');
              }}
            >
              <Text style={styles.startBtnText}>Start Scanning</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
};

const { width, height } = Dimensions.get('window');
const OVAL_W = width * 0.52;
const OVAL_H = OVAL_W * 1.3;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: {
    flex: 1,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  camPlaceholder: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: fs(14),
  },
  camSubtext: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: fs(11),
    marginTop: 4,
  },
  oval: {
    position: 'absolute',
    width: OVAL_W,
    height: OVAL_H,
    borderRadius: OVAL_W / 2,
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.7)',
    borderStyle: 'dashed',
    top: height * 0.1,
  },
  cancelBtn: {
    position: 'absolute',
    top: spacing.xl,
    right: spacing.xl,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { color: colors.white, fontSize: fs(16) },
  panel: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
    minHeight: height * 0.28,
  },
  progressTrack: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  panelTitle: { ...typography.h3, marginBottom: 8, textAlign: 'center' as const },
  panelSub: { ...typography.body, marginBottom: spacing.xl, textAlign: 'center' as const, color: colors.textSecondary },
  livenessContainer: { alignItems: 'center' as const, paddingTop: spacing.md },
  checksContainer: { width: '100%', paddingHorizontal: spacing.xl, marginBottom: spacing.lg, gap: 12 },
  checkRow: { flexDirection: 'row', alignItems: 'center' as const, gap: 12 },
  checkIcon: { fontSize: fs(18), width: 24, textAlign: 'center' as const },
  checkText: { ...typography.body, color: colors.textSecondary, flex: 1 },
  checkTextActive: { color: colors.success, fontWeight: '600' as const },
  scanningBadge: {
    backgroundColor: 'rgba(52, 199, 89, 0.15)',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: 100,
  },
  scanningText: { color: colors.success, fontSize: fs(14), fontWeight: '600' as const },
  startBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  startBtnText: {
    color: colors.white,
    fontSize: fs(16),
    fontWeight: '600' as const,
  },
  verifyingRow: { alignItems: 'center' as const, paddingVertical: spacing.xl },
  verifyingText: { ...typography.h3, color: colors.primary },
  feedbackBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    alignItems: 'center' as const,
  },
  feedbackText: {
    ...typography.body,
    color: colors.white,
    textAlign: 'center' as const,
  },
});
