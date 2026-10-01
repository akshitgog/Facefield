import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { SafeAreaWrapper } from '../../components';
import { colors, spacing, typography, radius, fs } from '../../theme';
import { useAttendanceStore } from '../../store';
import { AppTabParamList } from '../../navigation/AppTabs';
import { Calendar } from 'react-native-calendars';

type Props = BottomTabScreenProps<AppTabParamList, 'History'>;

export const HistoryScreen: React.FC<Props> = () => {
  const allRecords = useAttendanceStore((state) => state.records);
  const detailedRecords = useMemo(() => allRecords.filter(r => !r.isPurged), [allRecords]);

  const markedDates = useMemo(() => {
    const dates: any = {};
    const today = new Date();
    
    const recordMap = new Map();
    allRecords.forEach(r => {
      recordMap.set(r.date, r);
    });

    for (let i = 0; i < 30; i++) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      
      if (recordMap.has(dateStr)) {
        const record = recordMap.get(dateStr);
        dates[dateStr] = {
          selected: true,
          selectedColor: record.status === 'late' ? colors.warning : colors.success,
        };
      } else {
        // Skip marking weekends as absent if desired, but we'll mark all absent for now
        const dayOfWeek = d.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          dates[dateStr] = {
            selected: true,
            selectedColor: colors.error,
          };
        }
      }
    }
    return dates;
  }, [allRecords]);

  return (
    <SafeAreaWrapper>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={typography.h2}>Attendance Calendar</Text>
        </View>

        <View style={styles.calendarWrap}>
          <Calendar
            markedDates={markedDates}
            theme={{
              backgroundColor: colors.white,
              calendarBackground: colors.white,
              textSectionTitleColor: colors.textSecondary,
              selectedDayBackgroundColor: colors.primary,
              selectedDayTextColor: '#ffffff',
              todayTextColor: colors.primary,
              dayTextColor: colors.textPrimary,
              textDisabledColor: '#d9e1e8',
              dotColor: colors.primary,
              selectedDotColor: '#ffffff',
              arrowColor: colors.primary,
              disabledArrowColor: '#d9e1e8',
              monthTextColor: colors.textPrimary,
              textDayFontWeight: '500',
              textMonthFontWeight: 'bold',
              textDayHeaderFontWeight: '500',
            }}
          />
        </View>
        
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: colors.success }]} />
            <Text style={styles.legendText}>Present</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: colors.error }]} />
            <Text style={styles.legendText}>Absent</Text>
          </View>
        </View>
        <View style={styles.detailsContainer}>
          <Text style={styles.detailsTitle}>Detailed Offline Logs</Text>
          {detailedRecords.length === 0 ? (
            <Text style={styles.emptyText}>No detailed logs found. All heavy data has been purged to AWS.</Text>
          ) : (
            detailedRecords.map(record => (
              <View key={record.id} style={styles.recordCard}>
                <View style={styles.recordHeader}>
                  <Text style={styles.recordDate}>{record.date}</Text>
                  <Text style={[
                    styles.recordStatus, 
                    { color: record.status === 'present' ? colors.success : colors.error }
                  ]}>
                    {record.status.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.recordTime}>Entry: {record.entryTime ?? '--:--'}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: spacing.lg, paddingHorizontal: spacing.xl },
  header: { marginBottom: spacing.xl },
  calendarWrap: {
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingBottom: spacing.sm,
  },
  legend: {
    flexDirection: 'row',
    marginTop: spacing.xl,
    gap: spacing.xl,
    justifyContent: 'center',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    ...typography.bodyBold,
    color: colors.textSecondary,
  },
  detailsContainer: {
    marginTop: spacing.xxl,
    marginBottom: spacing.xxl,
  },
  detailsTitle: {
    ...typography.h3,
    marginBottom: spacing.md,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  recordCard: {
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  recordDate: {
    ...typography.bodyBold,
  },
  recordStatus: {
    ...typography.smallBold,
  },
  recordTime: {
    ...typography.small,
    color: colors.textSecondary,
  },
});
