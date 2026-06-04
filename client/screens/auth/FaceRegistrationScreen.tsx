import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Dimensions,
  ScrollView,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, SafeAreaWrapper } from '../../components';
import { colors, spacing, typography, radius, fs } from '../../theme';
import { useUserStore } from '../../store';
import { AuthStackParamList } from '../../navigation/AuthStack';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { useFaceAuth, FaceAuthResult } from '../../plugins/faceAuthPlugin';
import { saveEmbedding, StoredUser } from '../../store/embeddingStorage';

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
    { label: 'Lighting good', status: 'idle' },
    { label: 'Face centered', status: 'idle' },
    { label: 'Eyes visible', status: 'idle' },
    { label: 'Face size OK', status: 'idle' },
  ]);
  const [photoUri, setPhotoUri] = useState<string | undefined>();
  const photoUriRef = React.useRef<string | undefined>();
  const cameraRef = React.useRef<Camera>(null);

  const { setFaceRegistered, user, isLoggedIn, registerUser } = useUserStore();
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

  const { frameProcessor } = useFaceAuth({
    mode: 'registration',
    onResult: async (result: FaceAuthResult) => {
      if (phase !== 'camera') return;

      if (result.faceDetected) {
        setIndicators([
          { label: 'Face detected', status: 'ok' },
          { label: 'Lighting good', status: result.lightingGood ? 'ok' : 'warn' },
          { label: 'Face centered', status: result.faceCentered ? 'ok' : 'warn' },
          { label: 'Eyes visible', status: result.eyesVisible ? 'ok' : 'warn' },
          { label: 'Face size OK', status: result.faceSizeOk ? 'ok' : 'warn' },
        ]);
      } else {
        setIndicators([
          { label: 'Face detected', status: 'warn' },
          { label: 'Lighting good', status: 'idle' },
          { label: 'Face centered', status: 'idle' },
          { label: 'Eyes visible', status: 'idle' },
          { label: 'Face size OK', status: 'idle' },
        ]);
      }

      if (result.status === 'EMBEDDING' && result.embedding) {
        setPhase('processing');
        try {
          // Build permanent face image URI from native-cropped base64
          const permanentFaceUri = result.faceBase64
            ? `data:image/jpeg;base64,${result.faceBase64}`
            : photoUriRef.current;

          const storedUser: StoredUser = {
            userId: user?.id ?? Date.now().toString(),
            name: user?.name ?? 'Unknown',
            email: user?.email ?? '',
            embedding: result.embedding,
            faceImageUri: permanentFaceUri,
            registeredAt: new Date().toISOString(),
          };
          // saveEmbedding uses CONFLICT_REPLACE — old embedding is overwritten
          await saveEmbedding(storedUser);
          // Update user state with permanent face image
          setFaceRegistered(permanentFaceUri);
          // Persist updated user into multi-user registry (overwrites old entry)
          registerUser();
          setPhase('success');
        } catch (e) {
          Alert.alert('Error', 'Failed to save embedding.');
          setPhase('idle');
        }
      }
    },
  });

  // ── Handlers ──
  const handleStartCapture = () => {
    setPhase('camera');
  };

  // ── Success Screen ──
  if (phase === 'success') {
    return (
      <SafeAreaWrapper>
        <View style={styles.successContainer}>
          <View style={styles.successCircle}>
            <Text style={styles.checkmark}>✓</Text>
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
            label="Go to Dashboard"
            onPress={() => {
              if (isLoggedIn) {
                Alert.alert('Success', 'Face updated successfully.', [
                  { text: 'OK', onPress: () => navigation.goBack() }
                ]);
              } else {
                Alert.alert('Success', 'Account created successfully. Please login with your password.', [
                  { text: 'OK', onPress: () => (navigation as any).reset({ index: 0, routes: [{ name: 'Login' }] }) }
                ]);
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
            Please blink, smile, or turn your head slightly during capture.
          </Text>
        </View>

        {/* Camera preview area */}
        <View style={styles.cameraWrap}>
          {device && hasPermission && isReady ? (
            <Camera
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={true}
              photo={true}
              frameProcessor={phase === 'camera' ? frameProcessor : undefined}
              pixelFormat="yuv"
            />
          ) : (
            <View style={styles.cameraPlaceholder}>
              <Text style={styles.camPlaceholderText}>Camera Permission Required</Text>
              <Button 
                label="Grant Permission" 
                onPress={async () => {
                  const result = await requestPermission();
                  if (!result) {
                    Alert.alert('Permission Denied', 'Please enable camera access in your device settings.');
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
              {phase === 'processing' ? '⚡ Generating embeddings…' : 'Position your face within the oval'}
            </Text>
          </View>
        </View>

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
          onPress={() => {
            setPhase('idle');
            setIndicators([
              { label: 'Face detected', status: 'idle' },
              { label: 'Lighting good', status: 'idle' },
              { label: 'Face centered', status: 'idle' },
              { label: 'Eyes visible', status: 'idle' },
              { label: 'Face size OK', status: 'idle' },
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
