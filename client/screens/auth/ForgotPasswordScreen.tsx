import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, TextInput, SafeAreaWrapper } from '../../components';
import { colors, spacing, typography, fs } from '../../theme';
import { useUserStore } from '../../store';
import { AuthStackParamList } from '../../navigation/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

export const ForgotPasswordScreen: React.FC<Props> = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [answer, setAnswer] = useState('');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const { user: existingUser, updatePassword } = useUserStore();

  const handleVerifyEmail = () => {
    if (!email.trim()) {
      Alert.alert('Error', 'Please enter your email.');
      return;
    }
    
    // In a real app, this would query a backend. Here we check local storage.
    if (existingUser && existingUser.email.toLowerCase() === email.toLowerCase()) {
      setStep(2);
    } else {
      Alert.alert('Error', 'No account found with that email address.');
    }
  };

  const handleVerifyAnswer = () => {
    if (!answer.trim()) {
      Alert.alert('Error', 'Please enter your answer.');
      return;
    }

    if (existingUser && existingUser.favTeacher.toLowerCase() === answer.toLowerCase()) {
      setStep(3);
    } else {
      Alert.alert('Error', 'Incorrect answer.');
    }
  };

  const handleResetPassword = () => {
    if (newPassword.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match.');
      return;
    }

    updatePassword(newPassword);
    Alert.alert('Success', 'Your password has been successfully updated.', [
      { text: 'OK', onPress: () => navigation.goBack() }
    ]);
  };

  return (
    <SafeAreaWrapper>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kav}
      >
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.backBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.backText}>← Back to Login</Text>
            </TouchableOpacity>
            <Text style={typography.h2}>Forgot Password</Text>
            <Text style={styles.sub}>
              {step === 1 && 'Enter your email to recover your account.'}
              {step === 2 && 'Answer your security question to verify your identity.'}
              {step === 3 && 'Enter a new password for your account.'}
            </Text>
          </View>

          {step === 1 && (
            <View>
              <TextInput
                label="Email Address"
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <Button
                label="Continue"
                onPress={handleVerifyEmail}
                size="lg"
                style={{ marginTop: spacing.sm }}
              />
            </View>
          )}

          {step === 2 && (
            <View>
              <Text style={[typography.bodyBold, { marginBottom: spacing.md }]}>
                Security Question: Favorite teacher or food?
              </Text>
              <TextInput
                label="Your Answer"
                placeholder="Teacher's Name"
                value={answer}
                onChangeText={setAnswer}
                autoCapitalize="none"
              />
              <Button
                label="Verify"
                onPress={handleVerifyAnswer}
                size="lg"
                style={{ marginTop: spacing.sm }}
              />
            </View>
          )}

          {step === 3 && (
            <View>
              <TextInput
                label="New Password"
                placeholder="Min 6 characters"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                secureToggle
              />
              <TextInput
                label="Confirm Password"
                placeholder="Re-enter password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                secureToggle
              />
              <Button
                label="Reset Password"
                onPress={handleResetPassword}
                size="lg"
                style={{ marginTop: spacing.sm }}
              />
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  kav: { flex: 1 },
  container: {
    flex: 1,
    padding: spacing.xl,
    paddingTop: spacing.lg,
  },
  header: { marginBottom: spacing.xl },
  backBtn: { marginBottom: spacing.md },
  backText: { color: colors.primary, fontSize: fs(15), fontWeight: '500' },
  sub: { ...typography.small, marginTop: 8 },
});
