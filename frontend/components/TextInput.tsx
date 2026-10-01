import React, { useState } from 'react';
import {
  View,
  TextInput as RNTextInput,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInputProps,
  ViewStyle,
} from 'react-native';
import { colors, radius, spacing, fs, typography } from '../theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: ViewStyle;
  rightIcon?: React.ReactNode;
  secureToggle?: boolean;
}

export const TextInput: React.FC<InputProps> = ({
  label,
  error,
  containerStyle,
  rightIcon,
  secureToggle = false,
  secureTextEntry,
  ...props
}) => {
  const [secure, setSecure] = useState(secureTextEntry ?? false);
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.container, containerStyle]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View
        style={[
          styles.inputWrap,
          focused && styles.focused,
          !!error && styles.errBorder,
        ]}
      >
        <RNTextInput
          style={styles.input}
          placeholderTextColor={colors.textHint}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          secureTextEntry={secureToggle ? secure : secureTextEntry}
          {...props}
        />
        {secureToggle && (
          <TouchableOpacity
            onPress={() => setSecure(p => !p)}
            style={styles.iconBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.iconText}>{secure ? '👁️' : '🙈'}</Text>
          </TouchableOpacity>
        )}
        {rightIcon && <View style={styles.iconBtn}>{rightIcon}</View>}
      </View>
      {!!error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  label: {
    ...typography.label,
    marginBottom: spacing.xs,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  focused: {
    borderColor: colors.primary,
  },
  errBorder: {
    borderColor: colors.error,
  },
  input: {
    flex: 1,
    fontSize: fs(15),
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  errorText: {
    fontSize: fs(12),
    color: colors.error,
    marginTop: 4,
  },
  iconBtn: {
    paddingLeft: spacing.sm,
  },
  iconText: {
    fontSize: 16,
  },
});
