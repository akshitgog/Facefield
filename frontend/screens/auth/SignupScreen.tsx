import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, TextInput, SafeAreaWrapper } from '../../components';
import { colors, spacing, typography, radius, fs } from '../../theme';
import { AuthStackParamList } from '../../navigation/AuthStack';
import { useUserStore } from '../../store';
import { hashSecret, flushSecureStorage } from '../../store/secureStorage';

type Props = NativeStackScreenProps<AuthStackParamList, 'Signup'>;

interface FormData {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  address: string;
  workplace: string;
  age: string;
  idCard: string;
  disability: string;
  favTeacher: string;
}

export const SignupScreen: React.FC<Props> = ({ navigation }) => {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<FormData>({
    name: '', email: '', phone: '', password: '', confirmPassword: '',
    address: '', workplace: '', age: '', idCard: '', disability: '', favTeacher: '',
  });
  const [errors, setErrors] = useState<Partial<FormData>>({});

  const set = (field: keyof FormData) => (val: string) =>
    setForm((f) => ({ ...f, [field]: val }));

  const validateStep1 = () => {
    const e: Partial<FormData> = {};
    const trimmedName = form.name.trim();
    const normalizedEmail = form.email.trim().toLowerCase();
    const trimmedPhone = form.phone.trim();

    if (!trimmedName) e.name = 'Required';
    if (!normalizedEmail || !/\S+@\S+\.\S+/.test(normalizedEmail)) {
      e.email = 'Invalid email';
    } else {
      const existingUsers = useUserStore.getState().registeredUsers;
      if (existingUsers[normalizedEmail]) {
        e.email = 'An account with this email already exists';
      }
    }
    if (!trimmedPhone || trimmedPhone.length < 10) e.phone = 'Enter valid phone number';
    if (form.password.length < 6) e.password = 'Min 6 characters';
    if (form.password !== form.confirmPassword) e.confirmPassword = 'Passwords do not match';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const validateStep2 = () => {
    const e: Partial<FormData> = {};
    if (!form.address.trim()) e.address = 'Required';
    if (!form.workplace.trim()) e.workplace = 'Required';
    if (!form.age.trim() || isNaN(Number(form.age.trim()))) e.age = 'Enter valid age';
    if (!form.idCard.trim()) e.idCard = 'Required';
    if (!form.favTeacher.trim()) e.favTeacher = 'Required for account recovery';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const { setPendingUser } = useUserStore();

  const handleNext = () => {
    if (validateStep1()) setStep(2);
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (validateStep2()) {
      const normalizedEmail = form.email.trim().toLowerCase();
      const existingUsers = useUserStore.getState().registeredUsers;
      if (existingUsers[normalizedEmail]) {
        setStep(1);
        setErrors({ email: 'An account with this email already exists' });
        return;
      }

      setSubmitting(true);
      try {
      const passwordHash = await hashSecret(form.password);
      const recoveryAnswerHash = await hashSecret(form.favTeacher.trim().toLowerCase());
      setPendingUser({
        id: Date.now().toString(),
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        workplace: form.workplace.trim(),
        age: parseInt(form.age.trim(), 10),
        idCard: form.idCard.trim(),
        disability: form.disability.trim(),
        recoveryAnswerHash,
        passwordHash,
        faceRegistered: false,
      });
      await flushSecureStorage();
      navigation.navigate('FaceRegistration');
      } catch {
        Alert.alert('Error', 'Unable to save your account. Please try again.');
      } finally { setSubmitting(false); }
    }
  };

  return (
    <SafeAreaWrapper>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => (step === 2 ? setStep(1) : navigation.goBack())}
              style={styles.backBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
            <Text style={typography.h2}>Create Account</Text>
            <Text style={styles.sub}>Step {step} of 2</Text>
          </View>

          {/* Progress */}
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: step === 1 ? '50%' : '100%' }]} />
          </View>

          {/* Step 1 */}
          {step === 1 && (
            <View>
              <TextInput label="Full Name" placeholder="John Doe" value={form.name} onChangeText={set('name')} error={errors.name} />
              <TextInput label="Email Address" placeholder="you@example.com" value={form.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" error={errors.email} />
              <TextInput label="Phone Number" placeholder="e.g. 9876543210" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" error={errors.phone} />
              <TextInput label="Password" placeholder="Min 6 characters" value={form.password} onChangeText={set('password')} secureTextEntry secureToggle error={errors.password} />
              <TextInput label="Confirm Password" placeholder="Re-enter password" value={form.confirmPassword} onChangeText={set('confirmPassword')} secureTextEntry secureToggle error={errors.confirmPassword} />
              <Button label="Continue →" onPress={handleNext} size="lg" style={{ marginTop: spacing.sm }} />
            </View>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <View>
              <TextInput label="Residential Address" placeholder="Street, City, State" value={form.address} onChangeText={set('address')} error={errors.address} multiline numberOfLines={2} />
              <TextInput label="Workplace / Organisation" placeholder="e.g. Ministry of Roads" value={form.workplace} onChangeText={set('workplace')} error={errors.workplace} />
              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: spacing.sm }}>
                  <TextInput label="Age" placeholder="e.g. 30" value={form.age} onChangeText={set('age')} keyboardType="number-pad" error={errors.age} />
                </View>
                <View style={{ flex: 1 }}>
                  <TextInput label="ID Card Number" placeholder="e.g. MOR-001" value={form.idCard} onChangeText={set('idCard')} error={errors.idCard} />
                </View>
              </View>
              <TextInput label="Disability (optional)" placeholder="None / specify if applicable" value={form.disability} onChangeText={set('disability')} />
              <TextInput label="Security Question" placeholder="Favorite teacher or food?" value={form.favTeacher} onChangeText={set('favTeacher')} error={errors.favTeacher} />
              <Button label="Register & Set Up Face →" onPress={handleSubmit} loading={submitting} size="lg" style={{ marginTop: spacing.sm }} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    padding: spacing.xl,
    paddingTop: spacing.lg,
  },
  header: { marginBottom: spacing.lg },
  backBtn: { marginBottom: spacing.md },
  backText: { color: colors.primary, fontSize: fs(15), fontWeight: '500' },
  sub: { ...typography.small, marginTop: 4 },
  progressTrack: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginBottom: spacing.xl,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  row: { flexDirection: 'row' },
});
