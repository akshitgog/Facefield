import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, TextInput, SafeAreaWrapper } from '../../components';
import { colors, spacing, typography, radius, fs } from '../../theme';
import { AuthStackParamList } from '../../navigation/AuthStack';
import { useUserStore } from '../../store';

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
  const [form, setForm] = useState<FormData>({
    name: '', email: '', phone: '', password: '', confirmPassword: '',
    address: '', workplace: '', age: '', idCard: '', disability: '', favTeacher: '',
  });
  const [errors, setErrors] = useState<Partial<FormData>>({});

  const set = (field: keyof FormData) => (val: string) =>
    setForm((f) => ({ ...f, [field]: val }));

  const validateStep1 = () => {
    const e: Partial<FormData> = {};
    if (!form.name.trim()) e.name = 'Required';
    if (!/\S+@\S+\.\S+/.test(form.email)) e.email = 'Invalid email';
    if (!form.phone.trim() || form.phone.length < 10) e.phone = 'Enter valid phone number';
    if (form.password.length < 6) e.password = 'Min 6 characters';
    if (form.password !== form.confirmPassword) e.confirmPassword = 'Passwords do not match';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const validateStep2 = () => {
    const e: Partial<FormData> = {};
    if (!form.address.trim()) e.address = 'Required';
    if (!form.workplace.trim()) e.workplace = 'Required';
    if (!form.age || isNaN(Number(form.age))) e.age = 'Enter valid age';
    if (!form.idCard.trim()) e.idCard = 'Required';
    if (!form.favTeacher.trim()) e.favTeacher = 'Required for account recovery';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const { setPendingUser } = useUserStore();

  const handleNext = () => {
    if (validateStep1()) setStep(2);
  };

  const handleSubmit = () => {
    if (validateStep2()) {
      setPendingUser({
        id: Date.now().toString(),
        name: form.name,
        email: form.email.trim(),
        phone: form.phone,
        address: form.address,
        workplace: form.workplace,
        age: parseInt(form.age, 10),
        idCard: form.idCard,
        disability: form.disability,
        favTeacher: form.favTeacher,
        password: form.password,
        faceRegistered: false,
      });
      navigation.navigate('FaceRegistration');
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
              <Button label="Register & Set Up Face →" onPress={handleSubmit} size="lg" style={{ marginTop: spacing.sm }} />
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
