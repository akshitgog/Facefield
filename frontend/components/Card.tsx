import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { colors, radius, spacing, shadow } from '../theme';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  elevated?: boolean;
  color?: string;
}

export const Card: React.FC<CardProps> = ({
  children,
  style,
  elevated = false,
  color,
}) => (
  <View
    style={[
      styles.card,
      elevated && shadow,
      color ? { backgroundColor: color } : null,
      style,
    ]}
  >
    {children}
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
