import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Card, SafeAreaWrapper } from '../../components';
import { colors, spacing, typography, radius, fs } from '../../theme';
import { RootStackParamList } from '../../navigation/RootNavigator';
import { useUserStore } from '../../store';

type Props = NativeStackScreenProps<RootStackParamList, 'AttendanceSuccess'>;

export const AttendanceSuccessScreen: React.FC<Props> = ({ navigation, route }) => {
  const { record } = route.params;
  const { user } = useUserStore();
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 60, friction: 7 }),
      Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  const formattedDate = new Date(record.date).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <SafeAreaWrapper>
      <View style={styles.container}>
        <Animated.View style={{ transform: [{ scale }], opacity }}>
          <View style={styles.successCircle}>
            <Text style={styles.checkmark}>✓</Text>
          </View>
        </Animated.View>

        <Animated.View style={[styles.textBlock, { opacity }]}>
          <Text style={styles.name}>{user?.name ?? 'User'}</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Attendance Recorded</Text>
          </View>
          <Text style={styles.timestamp}>
            {formattedDate} · {record.entryTime}
          </Text>
        </Animated.View>

        <Card style={styles.detailCard}>
          <Row label="Type" value="Entry" />
          <Row label="Status" value="Present" />
          <Row label="Location" value={user?.workplace ?? '—'} />
          <Row
            label="Sync"
            value={record.synced ? 'Synced ✓' : 'Pending (Offline)'}
            last
          />
        </Card>

        <Button
          label="Back to Dashboard"
          onPress={() => navigation.popToTop()}
          size="lg"
          style={{ marginBottom: spacing.md }}
        />
        <Button
          label="View History"
          onPress={() => {
            navigation.popToTop();
            // Navigate to History tab
          }}
          variant="outline"
          size="lg"
        />
      </View>
    </SafeAreaWrapper>
  );
};

const Row = ({
  label, value, last = false,
}: {
  label: string; value: string; last?: boolean;
}) => (
  <View
    style={[
      styles.row,
      !last && { borderBottomWidth: 1, borderBottomColor: colors.border },
    ]}
  >
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowVal}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  checkmark: { color: colors.white, fontSize: fs(42), fontWeight: '700' },
  textBlock: { alignItems: 'center', marginBottom: spacing.xl },
  name: { ...typography.h2, marginBottom: spacing.sm },
  badge: {
    backgroundColor: colors.successLight,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    marginBottom: spacing.sm,
  },
  badgeText: { color: colors.success, fontWeight: '600', fontSize: fs(13) },
  timestamp: { ...typography.small },
  detailCard: { alignSelf: 'stretch', marginBottom: spacing.xl },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
  rowLabel: { ...typography.small },
  rowVal: { ...typography.bodyBold, fontSize: fs(14) },
});
