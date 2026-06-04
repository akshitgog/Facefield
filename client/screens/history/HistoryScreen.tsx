import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { SafeAreaWrapper, StatusBadge } from '../../components';
import { colors, spacing, typography, radius, fs } from '../../theme';
import { useAttendanceStore, AttendanceRecord } from '../../store';
import { AppTabParamList } from '../../navigation/AppTabs';

type Props = BottomTabScreenProps<AppTabParamList, 'History'>;

export const HistoryScreen: React.FC<Props> = () => {
  const allRecords = useAttendanceStore((state) => state.records);
  const [search, setSearch] = useState('');

  const records = useMemo(() => {
    const sorted = [...allRecords].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    if (!search.trim()) return sorted;
    return sorted.filter((r) =>
      r.date.includes(search) ||
      r.status.toLowerCase().includes(search.toLowerCase())
    );
  }, [allRecords, search]);

  const renderItem = ({ item }: { item: AttendanceRecord }) => {
    const d = new Date(item.date);
    const dateLabel = d.toLocaleDateString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
    return (
      <View style={styles.row}>
        <View style={styles.dateBlock}>
          <Text style={styles.dayNum}>{d.getDate()}</Text>
          <Text style={styles.month}>
            {d.toLocaleString('en-IN', { month: 'short' })}
          </Text>
        </View>
        <View style={styles.details}>
          <Text style={styles.dateLabel}>{dateLabel}</Text>
          <Text style={styles.times}>
            In: {item.entryTime ?? '—'} · Out: {item.exitTime ?? '—'}
          </Text>
        </View>
        <StatusBadge status={item.status} />
      </View>
    );
  };

  const ListEmpty = () => (
    <View style={styles.empty}>
      <Text style={typography.h3}>No records found</Text>
      <Text style={typography.small}>Mark attendance to see history here.</Text>
    </View>
  );

  return (
    <SafeAreaWrapper>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={typography.h2}>Attendance History</Text>
        </View>

        {/* Search */}
        <View style={styles.searchWrap}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by date or status…"
            placeholderTextColor={colors.textHint}
            value={search}
            onChangeText={setSearch}
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ color: colors.textHint, fontSize: fs(16) }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Summary */}
        <View style={styles.summaryRow}>
          {(['present', 'absent', 'late'] as const).map((s) => {
            const count = records.filter((r) => r.status === s).length;
            return (
              <View key={s} style={styles.summaryCard}>
                <Text style={styles.summaryCount}>{count}</Text>
                <Text style={styles.summaryLabel}>{s.charAt(0).toUpperCase() + s.slice(1)}</Text>
              </View>
            );
          })}
        </View>

        {/* List */}
        <FlatList
          data={records}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          ListEmptyComponent={ListEmpty}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      </View>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: spacing.lg },
  header: { paddingHorizontal: spacing.xl, marginBottom: spacing.md },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    marginHorizontal: spacing.xl,
    paddingHorizontal: spacing.md,
    height: 48,
    marginBottom: spacing.md,
  },
  searchIcon: { fontSize: 16, marginRight: spacing.sm },
  searchInput: {
    flex: 1,
    fontSize: fs(14),
    color: colors.textPrimary,
  },
  summaryRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  summaryCount: { fontSize: fs(18), fontWeight: '700', color: colors.textPrimary },
  summaryLabel: { fontSize: fs(11), color: colors.textSecondary },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateBlock: {
    alignItems: 'center',
    marginRight: spacing.md,
    minWidth: 36,
  },
  dayNum: { fontSize: fs(18), fontWeight: '700', color: colors.primary },
  month: { fontSize: fs(11), color: colors.textSecondary },
  details: { flex: 1 },
  dateLabel: { ...typography.bodyBold, fontSize: fs(14) },
  times: { ...typography.small, marginTop: 2 },
  sep: { height: spacing.sm },
  empty: {
    alignItems: 'center',
    paddingTop: spacing.xxl,
    gap: spacing.sm,
  },
});
