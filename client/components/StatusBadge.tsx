import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, fs } from '../theme';

// ── StatusBadge ─────────────────────────────────────────────────────────────
type Status = 'present' | 'absent' | 'late' | 'pending' | 'offline' | 'active';

const badgeConfig: Record<Status, { bg: string; text: string; label: string }> = {
  present:  { bg: colors.successLight, text: colors.success,     label: 'Present'  },
  absent:   { bg: colors.errorLight,   text: colors.error,       label: 'Absent'   },
  late:     { bg: colors.warningLight, text: colors.warning,     label: 'Late'     },
  pending:  { bg: '#FFF3E0',           text: '#E65100',          label: 'Pending'  },
  offline:  { bg: colors.primaryLight, text: colors.primaryDark, label: 'Offline'  },
  active:   { bg: colors.successLight, text: colors.success,     label: 'Active'   },
};

export const StatusBadge: React.FC<{ status: Status; label?: string }> = ({
  status,
  label,
}) => {
  const cfg = badgeConfig[status];
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.badgeText, { color: cfg.text }]}>
        {label ?? cfg.label}
      </Text>
    </View>
  );
};

// ── SafeAreaWrapper ──────────────────────────────────────────────────────────
import { ViewStyle } from 'react-native';

interface SafeProps {
  children: React.ReactNode;
  style?: ViewStyle;
  bg?: string;
}

export const SafeAreaWrapper: React.FC<SafeProps> = ({
  children,
  style,
  bg = colors.background,
}) => (
  <SafeAreaView style={[{ flex: 1, backgroundColor: bg }, style]} edges={['top', 'bottom']}>
    {children}
  </SafeAreaView>
);

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: fs(12),
    fontWeight: '600',
  },
});
