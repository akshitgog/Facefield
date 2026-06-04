import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, TextInput, SafeAreaWrapper } from '../../components';
import { colors, spacing, typography, fs } from '../../theme';
import { useUserStore } from '../../store';
import { AuthStackParamList } from '../../navigation/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export const LoginScreen: React.FC<Props> = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const { registeredUsers, setUser, setToken } = useUserStore();

  const validate = () => {
    const e: typeof errors = {};
    if (!email.trim()) e.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) e.email = 'Enter a valid email';
    if (!password.trim()) e.password = 'Password is required';
    else if (password.length < 6) e.password = 'Minimum 6 characters';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 600));

      const key = email.trim().toLowerCase();
      const found = registeredUsers[key];

      if (!found) {
        Alert.alert('Account not found', 'No account exists with this email. Please sign up first.');
        setLoading(false);
        return;
      }

      if (found.password && found.password !== password) {
        Alert.alert('Login failed', 'Incorrect password.');
        setLoading(false);
        return;
      }

      setToken('local-auth-token');
      setUser(found);
    } catch {
      Alert.alert('Login failed', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaWrapper>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kav}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo / Brand */}
          <View style={styles.brand}>
            <Image 
              source={require('../../assets/logo.png')} 
              style={styles.logoImage} 
              resizeMode="contain"
            />
            <Text style={styles.appName}>Biometr</Text>
            <Text style={styles.tagline}>Offline Face Auth & Attendance</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <TextInput
              label="Email Address"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              error={errors.email}
            />
            <TextInput
              label="Password"
              placeholder="Enter password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              secureToggle
              returnKeyType="done"
              onSubmitEditing={handleLogin}
              error={errors.password}
            />

            <Button
              label="Login"
              onPress={handleLogin}
              loading={loading}
              style={styles.loginBtn}
              size="lg"
            />

            <Button
              label="Create Account"
              onPress={() => navigation.navigate('Signup')}
              variant="outline"
              size="lg"
              style={styles.signupBtn}
            />

            <Button
              label="Forgot Password?"
              onPress={() => navigation.navigate('ForgotPassword')}
              variant="ghost"
              size="sm"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  kav: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    justifyContent: 'center',
  },
  brand: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  logoImage: {
    width: 96,
    height: 96,
    borderRadius: 24,
    marginBottom: spacing.md,
  },
  appName: {
    ...typography.h1,
    marginBottom: 4,
  },
  tagline: {
    ...typography.small,
    textAlign: 'center',
  },
  form: {},
  loginBtn: { marginTop: spacing.sm, marginBottom: spacing.md },
  signupBtn: { marginBottom: spacing.sm },
});
