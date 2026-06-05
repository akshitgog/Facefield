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
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaWrapper } from '../../components';
import { colors, spacing, typography, radius, fs } from '../../theme';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { useAttendanceStore } from '../../store';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { useFaceAuth, FaceAuthResult } from '../../plugins/faceAuthPlugin';
import { saveAttendance } from '../../store/embeddingStorage';

type Props = NativeStackScreenProps<RootStackParamList, 'AttendanceVerification'>;

export const AttendanceVerificationScreen: React.FC<Props> = ({ navigation }) => {
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

  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const isFocused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const lastFaceSeenTime = useRef<number>(Date.now());

  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
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

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    if (scanStatus === 'scanning') {
      timeoutId = setTimeout(() => {
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

  const { frameProcessor } = useFaceAuth({
    mode: 'attendance',
    onResult: (result: FaceAuthResult) => {
      // Only process if we are actively scanning
      if (scanStatus !== 'scanning') {
        lastFaceSeenTime.current = Date.now();
        return;
      }

      if (result.faceDetected) {
        lastFaceSeenTime.current = Date.now();
      } else {
        if (Date.now() - lastFaceSeenTime.current > 4000) {
          setScanStatus('idle');
          setFeedbackMsg('No face detected.');
          Alert.alert('Timeout', 'No face detected for 4 seconds. Please ensure your face is inside the oval.');
          return;
        }
      }

      console.log(
        result.status,
        result.reason,
        result.recognitionScore,
        result.matchedUserId
      );

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
      } else if (scanStatus === 'scanning') {
        livenessStatus = 'warn';
      }

      let recogStatus = 'idle';
      if (result.matchedUserId !== undefined) {
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
        // Only run this once to prevent multiple redirects during the delay
        if (scanStatus === 'scanning') {
          setScanStatus('verifying');
          setFeedbackMsg('Face verified successfully!');
          setTimeout(() => {
            handleVerified(result.matchedUserId ?? 'unknown');
          }, 800);
        }
      }
      if (result.status === 'REJECT') {
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
    },
  });

  const handleVerified = async (userId: string) => {
    setScanStatus('done');
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const record = {
      id: Date.now().toString(),
      date: now.toISOString().split('T')[0],
      entryTime: timeStr,
      userId: userId,
      status: 'present' as const,
      synced: false,
    };
    addRecord(record);
    await saveAttendance(record);
    navigation.replace('AttendanceSuccess', { record });
  };

  const progress = scanStatus === 'idle' ? 0 : scanStatus === 'scanning' ? 0.5 : 1;
  const isCameraScanning = scanStatus === 'scanning' || scanStatus === 'verifying';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* Full-screen camera */}
      <View style={styles.camera}>
        {device && hasPermission && isReady ? (
          <Camera
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={isFocused && appActive}
            frameProcessor={isCameraScanning ? frameProcessor : undefined}
            pixelFormat="yuv"
          />
        ) : (
          <View style={{ alignItems: 'center', justifyContent: 'center', flex: 1 }}>
            <Text style={styles.camPlaceholder}>Requesting Camera Permission...</Text>
          </View>
        )}

        {/* Face oval guide — drawn on UI layer, does NOT affect model input */}
        <View style={styles.oval} pointerEvents="none" />

        {/* Cancel button */}
        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.cancelText}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom overlay panel */}
      <View style={styles.panel}>
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
              onPress={() => setScanStatus('scanning')}
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
});
