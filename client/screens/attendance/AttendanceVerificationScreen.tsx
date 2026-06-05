import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  StatusBar,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
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
  const { addRecord } = useAttendanceStore();

  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');

  const [isReady, setIsReady] = useState(false);

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
      if (scanStatus !== 'scanning') return;

      console.log(
        result.status,
        result.reason,
        result.recognitionScore,
        result.matchedUserId
      );

      if (result.status === 'RETRY') {
        if (result.reason) setFeedbackMsg(result.reason);
      }
      if (result.status === 'ACCEPT') {
        setFeedbackMsg('Face verified successfully!');
        handleVerified(result.matchedUserId ?? 'unknown');
      }
      if (result.status === 'REJECT') {
        setScanStatus('idle');
        setFeedbackMsg(result.reason || 'Verification Failed');
        Alert.alert('Verification Failed', result.reason);
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
            isActive={isCameraScanning}
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
  checkRow: { flexDirection: 'row', alignItems: 'center' as const, gap: 10 },
  checkIcon: { fontSize: fs(18) },
  checkText: { ...typography.body, color: colors.textSecondary },
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
