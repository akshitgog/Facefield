import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Dimensions,
  ScrollView,
  Image,
  AppState,
  PermissionsAndroid,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import { Button, SafeAreaWrapper } from '../../components';
import { colors, spacing, typography, radius, fs } from '../../theme';
import { useUserStore } from '../../store';
import { AuthStackParamList } from '../../navigation/AuthStack';
import { CameraXView, FaceAuthResult } from '../../plugins/faceAuthPlugin';
import { saveEmbedding, StoredUser } from '../../store/embeddingStorage';
import { flushSecureStorage } from '../../store/secureStorage';

type Props = NativeStackScreenProps<AuthStackParamList, 'FaceRegistration'>;

interface Indicator {
  label: string;
  status: 'ok' | 'warn' | 'idle';
}

export const FaceRegistrationScreen: React.FC<Props> = ({ navigation }) => {
  // ── All hooks MUST be called before any conditional returns ──
  const [phase, setPhase] = useState<'idle' | 'camera' | 'processing' | 'success'>('idle');
  const [indicators, setIndicators] = useState<Indicator[]>([
    { label: 'Face detected', status: 'idle' },
    { label: 'Quality & Lighting', status: 'idle' }
  ]);
  const [feedback, setFeedback] = useState<string>('Position your face within the oval');
  const [hasPermission, setHasPermission] = useState(false);
  const [frameSeen, setFrameSeen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const isHandledRef = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const { setFaceRegistered, user, isLoggedIn, registerUser } = useUserStore();
  const userRef = useRef(user);
  userRef.current = user;

  const isFocused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const mountedRef = useRef(true);
  const activeRef = useRef(false);
  activeRef.current = isFocused && appActive;
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useEffect(() => navigation.addListener('beforeRemove', () => {
    activeRef.current = false;
    phaseRef.current = 'idle';
  }), [navigation]);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        activeRef.current = false;
        if (phaseRef.current === 'camera') {
          phaseRef.current = 'idle';
          setPhase('idle');
        }
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
          message: 'FaceField needs camera access for face registration.',
          buttonPositive: 'OK',
        }
      );
      setHasPermission(result === PermissionsAndroid.RESULTS.GRANTED);
    })();
  }, []);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    if (phase === 'camera') {
      timeoutId = setTimeout(() => {
        phaseRef.current = 'idle';
        setPhase('idle');
        Alert.alert(
          'Timeout',
          'Registration took too long. Please ensure good lighting, look straight, blink, then hold still.'
        );
      }, 15000); // 15 seconds timeout
    }
    return () => clearTimeout(timeoutId);
  }, [phase]);

  // Stable callback via refs — never recreated, no stale closures
  const handleFaceResult = useCallback(async (event: { nativeEvent: FaceAuthResult }) => {
    if (!mountedRef.current || !activeRef.current) return;
    const result = event.nativeEvent;
    if (result.frameProcessed) setFrameSeen(true);
    if (result.status === 'ERROR') {
      phaseRef.current = 'idle';
      setPhase('idle');
      setCameraError(result.reason);
      return;
    }
    if (result.status === 'REJECT' && phaseRef.current === 'camera') {
      phaseRef.current = 'idle';
      setPhase('idle');
      Alert.alert('Registration Failed', result.reason);
      return;
    }

    // 1. Always update real-time indicators
    if (result.faceDetected) {
      setIndicators([
        { label: 'Face detected', status: 'ok' },
        { label: 'Quality & Lighting', status: result.qualityPassed ? 'ok' : 'warn' },
      ]);
    } else {
      setIndicators([
        { label: 'Face detected', status: 'warn' },
        { label: 'Quality & Lighting', status: 'idle' }
      ]);
    }

    if (result.reason) {
      setFeedback(result.reason);
    }

    // 2. Only proceed to save if the user clicked Capture
    if (phaseRef.current !== 'camera' || isHandledRef.current) return;

    if (result.status === 'EMBEDDING' && result.embedding) {
      if (isHandledRef.current) return;
      isHandledRef.current = true;
      phaseRef.current = 'processing';
      setPhase('processing');
      try {
        // Build permanent face image URI from native-cropped base64
        const permanentFaceUri = result.faceBase64
          ? `data:image/jpeg;base64,${result.faceBase64}`
          : undefined;

        const currentUser = userRef.current;
        if (!currentUser) throw new Error('Account is unavailable');
        const storedUser: StoredUser = {
          userId: currentUser.id,
          name: currentUser.name,
          email: currentUser.email,
          embedding: result.embedding,
          faceImageUri: permanentFaceUri,
          registeredAt: new Date().toISOString(),
          account: { ...currentUser, faceRegistered: true, faceImageUri: permanentFaceUri },
        };
        // saveEmbedding uses CONFLICT_REPLACE — old embedding is overwritten
        await saveEmbedding(storedUser);
        if (!mountedRef.current || userRef.current?.id !== currentUser.id) return;
        // Update user state with permanent face image
        setFaceRegistered(permanentFaceUri);
        // Persist updated user into multi-user registry (overwrites old entry)
        registerUser();
        await flushSecureStorage();
        if (mountedRef.current) {
          phaseRef.current = 'success';
          setPhase('success');
        }
      } catch (e) {
        if (!mountedRef.current) return;
        isHandledRef.current = false;
        phaseRef.current = 'idle';
        Alert.alert('Error', 'Failed to save embedding.');
        setPhase('idle');
      }
    }
  }, [setFaceRegistered, registerUser]);

  // ── Handlers ──
  const handleStartCapture = () => {
    if (!hasPermission || cameraError) return;
    isHandledRef.current = false;
    phaseRef.current = 'camera';
    setPhase('camera');
  };

  // ── Success Screen ──
  if (phase === 'success') {
    return (
      <SafeAreaWrapper>
        <View style={styles.successContainer}>
          <View style={[styles.successCircle, { overflow: 'hidden' }]}>
            {user?.faceImageUri ? (
              <Image source={{ uri: user.faceImageUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            ) : (
              <Text style={styles.checkmark}>✓</Text>
            )}
          </View>
          <Text style={[typography.h2, { marginBottom: spacing.sm, textAlign: 'center' }]}>
            Face Registered
          </Text>
          <Text style={[typography.small, { textAlign: 'center', marginBottom: spacing.md }]}>
            Your face has been saved securely on this device.
          </Text>
          <Text style={styles.detailText}>
            5 augmented embeddings generated, averaged, and L2-normalized.
          </Text>
          <Button
            label={isLoggedIn ? 'Go to Dashboard' : 'Continue to Login'}
            onPress={() => {
              if (isLoggedIn) {
                navigation.goBack();
              } else {
                (navigation as any).reset({
                  index: 0,
                  routes: [{ name: 'Login', params: { prefilledEmail: user?.email } }],
                });
              }
            }}
            size="lg"
            style={{ marginTop: spacing.xl }}
          />
        </View>
      </SafeAreaWrapper>
    );
  }

  // ── Camera Screen ──
  return (
    <SafeAreaWrapper bg={colors.background}>
      <ScrollView contentContainerStyle={styles.scrollContainer} bounces={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={typography.h2}>Register Your Face</Text>
          <Text style={typography.small}>
            Tap capture, blink, then hold still to complete registration.
          </Text>
        </View>

        {/* Camera preview area */}
        <View style={styles.cameraWrap}>
          {hasPermission && isReady ? (
            <CameraXView
              style={StyleSheet.absoluteFill}
              mode="registration"
              isActive={isFocused && appActive && phase !== 'processing' && !cameraError}
              isCaptureRequested={phase === 'camera'}
              onFaceAuthResult={handleFaceResult}
            />
          ) : (
            <View style={styles.cameraPlaceholder}>
              <Text style={styles.camPlaceholderText}>Camera Permission Required</Text>
              <Button
                label="Grant Permission"
                onPress={async () => {
                  const result = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.CAMERA
                  );
                  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
                    Alert.alert('Permission Denied', 'Please enable camera access in your device settings.');
                  } else {
                    setHasPermission(true);
                  }
                }}
                size="sm"
              />
            </View>
          )}

          {/* Face guide oval */}
          <View style={styles.faceGuide} pointerEvents="none" />

          {/* Instruction */}
          <View style={styles.camInstruction}>
            <Text style={styles.camInstructionText}>
              {phase === 'processing' ? '⚡ Generating embeddings…' : feedback}
            </Text>
          </View>
        </View>

        {frameSeen && !cameraError && <Text testID="camera-analysis-ready">Camera ready</Text>}
        {cameraError && <>
          <Text testID="camera-error">{cameraError}</Text>
          <Button label="Retry Camera" onPress={() => { setCameraError(null); setFrameSeen(false); }} />
        </>}

        {/* Quality indicators */}
        <View style={styles.indicators}>
          {indicators.map((ind) => (
            <View key={ind.label} style={styles.indRow}>
              <View
                style={[
                  styles.dot,
                  ind.status === 'ok' && styles.dotGreen,
                  ind.status === 'warn' && styles.dotYellow,
                  ind.status === 'idle' && styles.dotGray,
                ]}
              />
              <Text style={[typography.body, { fontSize: fs(12) }]}>{ind.label}</Text>
            </View>
          ))}
        </View>

        {/* Actions */}
        <Button
          label={phase === 'processing' ? 'Processing…' : 'Capture & Register'}
          onPress={() => {
            if (phase === 'idle') {
              handleStartCapture();
            }
          }}
          loading={phase === 'processing' || phase === 'camera'}
          size="lg"
          style={{ marginBottom: spacing.md }}
        />
        <Button
          label="Retake"
          disabled={phase === 'processing'}
          onPress={() => {
            phaseRef.current = 'idle';
            isHandledRef.current = false;
            setPhase('idle');
            setIndicators([
              { label: 'Face detected', status: 'idle' },
              { label: 'Quality & Lighting', status: 'idle' }
            ]);
          }}
          variant="outline"
          size="lg"
        />
      </ScrollView>
    </SafeAreaWrapper>
  );
};

const { width } = Dimensions.get('window');
const OVAL_W = width * 0.5;
const OVAL_H = OVAL_W * 1.25;

const styles = StyleSheet.create({
  scrollContainer: { flexGrow: 1, padding: spacing.xl, paddingBottom: spacing.xxl },
  header: { marginBottom: spacing.md },
  cameraWrap: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#111',
    marginBottom: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a1a',
    padding: spacing.md,
  },
  camPlaceholderText: { color: 'rgba(255,255,255,0.6)', fontSize: fs(14), marginBottom: spacing.md, textAlign: 'center' },
  faceGuide: {
    position: 'absolute',
    width: OVAL_W,
    height: OVAL_H,
    borderRadius: OVAL_W / 2,
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.6)',
    borderStyle: 'dashed',
  },
  camInstruction: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  camInstructionText: { color: colors.white, fontSize: fs(13) },
  indicators: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: spacing.md
  },
  indRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '48%',
    marginBottom: spacing.sm
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: spacing.xs },
  dotGreen: { backgroundColor: colors.success },
  dotYellow: { backgroundColor: colors.warning },
  dotGray: { backgroundColor: colors.border },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  successCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  checkmark: { color: colors.white, fontSize: fs(36), fontWeight: '700' },
  detailText: {
    fontSize: fs(12),
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
