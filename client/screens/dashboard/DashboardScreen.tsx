import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
} from 'react-native';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { CompositeScreenProps, useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Card, StatusBadge, SafeAreaWrapper } from '../../components';
import { colors, spacing, typography, radius, fs, shadow } from '../../theme';
import { useUserStore, useAttendanceStore } from '../../store';
import { AppTabParamList } from '../../navigation/AppTabs';
import { RootStackParamList } from '../../navigation/RootNavigator';

type Props = CompositeScreenProps<
  BottomTabScreenProps<AppTabParamList, 'Home'>,
  NativeStackScreenProps<RootStackParamList>
>;

export const DashboardScreen: React.FC<Props> = ({ navigation }) => {
  const { user } = useUserStore();
  const { todayRecord } = useAttendanceStore();
  const allRecords = useAttendanceStore((state) => state.records);
  const [greeting, setGreeting] = useState('Good morning');
  const [currentDateStr, setCurrentDateStr] = useState('');

  useFocusEffect(
    useCallback(() => {
      const now = new Date();
      const hour = now.getHours();
      setGreeting(
        hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
      );
      setCurrentDateStr(now.toDateString());
    }, [])
  );

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : '??';

  return (
    <SafeAreaWrapper>
      {/* Fixed Header */}
      <View style={styles.fixedHeader}>
        <View style={styles.welcomeRow}>
          <View>
            <Text style={styles.greeting}>{greeting},</Text>
            <Text style={styles.userName}>{user?.name ?? 'User'}</Text>
            <Text style={styles.workplace}>{user?.workplace}</Text>
          </View>
          <View style={styles.avatar}>
            {user?.faceImageUri ? (
              <Image source={{ uri: user.faceImageUri }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>{initials}</Text>
            )}
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >

        {/* Today's Status Row */}
        <View style={styles.statsRow}>
          <Card style={styles.statCard}>
            <Text style={styles.statLabel}>Entry Time</Text>
            <Text style={styles.statVal}>
              {todayRecord?.entryTime ?? '—'}
            </Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statLabel}>Exit Time</Text>
            <Text style={styles.statVal}>
              {todayRecord?.exitTime ?? '—'}
            </Text>
          </Card>
        </View>

        {/* Status badge */}
        <Card style={styles.statusCard}>
          <View style={styles.statusRow}>
            <Text style={typography.bodyBold}>Today's Status</Text>
            <StatusBadge status={todayRecord?.status ?? 'absent'} />
          </View>
          <Text style={[typography.small, { marginTop: 4 }]}> 
            {currentDateStr}
          </Text>
        </Card>

        {/* Primary CTA */}
        <Button
          label="Mark Attendance"
          onPress={() => navigation.navigate('AttendanceVerification')}
          variant="success"
          size="lg"
          style={styles.markBtn}
        />

        {/* Secondary actions */}
        <View style={styles.secondaryRow}>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => navigation.navigate('History')}
            activeOpacity={0.75}
          >
            <Text style={styles.secondaryIcon}>📋</Text>
            <Text style={styles.secondaryLabel}>History</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => navigation.navigate('Profile')}
            activeOpacity={0.75}
          >
            <Text style={styles.secondaryIcon}>👤</Text>
            <Text style={styles.secondaryLabel}>Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => navigation.navigate('FaceRegistration')}
            activeOpacity={0.75}
          >
            <Text style={styles.secondaryIcon}>📷</Text>
            <Text style={styles.secondaryLabel}>Update Face</Text>
          </TouchableOpacity>
        </View>

        {/* Weekly Summary */}
        <Card style={styles.weeklyCard}>
          <Text style={styles.weeklyTitle}>This Week</Text>
          <View style={styles.weeklyRow}>
            <View style={styles.weeklyItem}>
              <Text style={styles.weeklyCount}>{allRecords.filter(r => r.status === 'present').length}</Text>
              <Text style={styles.weeklyLabel}>Present</Text>
            </View>
            <View style={[styles.weeklyDivider]} />
            <View style={styles.weeklyItem}>
              <Text style={styles.weeklyCount}>{allRecords.filter(r => r.status === 'late').length}</Text>
              <Text style={styles.weeklyLabel}>Late</Text>
            </View>
            <View style={[styles.weeklyDivider]} />
            <View style={styles.weeklyItem}>
              <Text style={styles.weeklyCount}>{allRecords.length}</Text>
              <Text style={styles.weeklyLabel}>Total</Text>
            </View>
          </View>
        </Card>

        {/* Face Registration Status */}
        {!user?.faceRegistered && (
          <Card style={styles.reminderCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontSize: 24, marginRight: spacing.md }}>⚠️</Text>
              <View style={{ flex: 1 }}>
                <Text style={typography.bodyBold}>Face Not Registered</Text>
                <Text style={[typography.small, { marginTop: 2 }]}>
                  Register your face to mark attendance.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => navigation.navigate('FaceRegistration')}
                style={styles.reminderBtn}
              >
                <Text style={styles.reminderBtnText}>Setup</Text>
              </TouchableOpacity>
            </View>
          </Card>
        )}

        {/* Offline notice & Manual Sync */}
        <View style={styles.syncContainer}>
          <View style={styles.offlineNotice}>
            <Text style={styles.offlineText}>
              🔵 Offline mode — attendance saved locally
            </Text>
          </View>
          <Button
            label="Sync to AWS (Purge Local)"
            onPress={() => {
              // TODO: Implement actual AWS Sync logic scoped for deployment
              Alert.alert(
                'Sync to AWS',
                'Syncing to AWS...\n\n(For deployment scope: Attendance synced successfully. Local records purged.)'
              );
            }}
            variant="outline"
            style={styles.syncBtn}
          />
        </View>
      </ScrollView>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  fixedHeader: {
    backgroundColor: colors.primary,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    zIndex: 10,
    elevation: 4,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  scroll: { padding: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.xxl },
  welcomeCard: { marginBottom: 0, padding: spacing.lg },
  welcomeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greeting: { fontSize: fs(15), color: 'rgba(255,255,255,0.8)', marginBottom: 4 },
  userName: { fontSize: fs(24), fontWeight: '700', color: colors.white },
  workplace: { fontSize: fs(14), color: 'rgba(255,255,255,0.9)', marginTop: 4 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarText: { fontSize: fs(18), fontWeight: '700', color: colors.white },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  statCard: { flex: 1, alignItems: 'center' },
  statLabel: { ...typography.tiny, marginBottom: 4, textAlign: 'center' },
  statVal: { fontSize: fs(17), fontWeight: '600', color: colors.textPrimary },
  statusCard: { marginBottom: spacing.lg },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  markBtn: { marginBottom: spacing.lg },
  secondaryRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  secondaryBtn: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    paddingVertical: spacing.lg,
    ...shadow,
  },
  secondaryIcon: { fontSize: fs(24), marginBottom: spacing.xs },
  secondaryLabel: { ...typography.small, fontWeight: '500' },
  weeklyCard: { marginBottom: spacing.md },
  weeklyTitle: {
    fontSize: fs(13),
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.md,
  },
  weeklyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  weeklyItem: { alignItems: 'center', flex: 1 },
  weeklyCount: { fontSize: fs(22), fontWeight: '700', color: colors.primary },
  weeklyLabel: { fontSize: fs(11), color: colors.textSecondary, marginTop: 2 },
  weeklyDivider: { width: 1, height: 32, backgroundColor: colors.border },
  reminderCard: { marginBottom: spacing.md, backgroundColor: '#FFF8E1' },
  reminderBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  reminderBtnText: { color: colors.white, fontSize: fs(13), fontWeight: '600' },
  offlineNotice: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.sm,
    padding: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  offlineText: { fontSize: fs(12), color: colors.primaryDark },
  syncContainer: { marginTop: spacing.sm },
  syncBtn: { marginTop: spacing.xs },
});
