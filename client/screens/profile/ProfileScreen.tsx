import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Image,
  Modal,
} from 'react-native';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { SafeAreaWrapper, Card, Button, StatusBadge } from '../../components';
import { colors, spacing, typography, radius, fs } from '../../theme';
import { useUserStore } from '../../store';
import { AppTabParamList } from '../../navigation/AppTabs';

import { CompositeScreenProps } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/RootNavigator';

type Props = CompositeScreenProps<
  BottomTabScreenProps<AppTabParamList, 'Profile'>,
  NativeStackScreenProps<RootStackParamList>
>;

export const ProfileScreen: React.FC<Props> = ({ navigation }) => {
  const { user, logout } = useUserStore();
  const [modalVisible, setModalVisible] = useState(false);

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : '??';

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <SafeAreaWrapper>
      {/* Fixed Header */}
      <View style={styles.fixedHeader}>
        <View style={styles.avatarSection}>
          <TouchableOpacity style={styles.avatar} onPress={() => setModalVisible(true)}>
            {user?.faceImageUri ? (
              <Image source={{ uri: user.faceImageUri }} style={styles.avatarImage} resizeMode="cover" />
            ) : (
              <Text style={styles.avatarText}>{initials}</Text>
            )}
          </TouchableOpacity>
          <Text style={[typography.h2, { color: colors.white }]}>{user?.name}</Text>
          <Text style={[typography.small, { color: 'rgba(255,255,255,0.8)' }]}>{user?.email}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Personal details */}
        <SectionCard title="Personal Details">
          <DetailRow label="Phone" value={user?.phone || '—'} />
          <DetailRow label="Age" value={String(user?.age ?? '—')} />
          <DetailRow label="Address" value={user?.address ?? '—'} />
          <DetailRow label="Disability" value={user?.disability || 'None'} last />
        </SectionCard>

        {/* Workplace */}
        <SectionCard title="Workplace">
          <DetailRow label="Organisation" value={user?.workplace ?? '—'} last />
        </SectionCard>

        {/* ID Details */}
        <SectionCard title="ID Card Details">
          <DetailRow label="ID Number" value={user?.idCard ?? '—'} last />
        </SectionCard>

        {/* Face Registration */}
        <Card style={styles.faceCard}>
          <View style={styles.faceRow}>
            <TouchableOpacity style={styles.facePrev} onPress={() => setModalVisible(true)}>
              {user?.faceImageUri ? (
                <Image source={{ uri: user.faceImageUri }} style={styles.faceImage} resizeMode="cover" />
              ) : (
                <Text style={styles.faceIcon}>🪪</Text>
              )}
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={typography.bodyBold}>Registered Face</Text>
              <Text style={[typography.small, { marginTop: 4 }]}> 
                Stored locally on device
              </Text>
              <View style={{ marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center' }}>
                <StatusBadge
                  status={user?.faceRegistered ? 'active' : 'absent'}
                  label={user?.faceRegistered ? 'Active' : 'Not registered'}
                />
                <TouchableOpacity 
                  style={{ marginLeft: spacing.md, padding: 4 }}
                  onPress={() => navigation.navigate('FaceRegistration')}
                >
                  <Text style={{ color: colors.primary, fontSize: fs(13), fontWeight: '600' }}>
                    Update
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Card>

        {/* App info */}
        <View style={styles.appInfo}>
          <Text style={styles.appInfoText}>FieldAttend v1.0 · Offline Mode</Text>
        </View>

        {/* Logout */}
        <Button 
          label="Logout" 
          onPress={handleLogout} 
          variant="outline" 
          style={{ borderColor: colors.error }} 
          textStyle={{ color: colors.error }} 
        />
      </ScrollView>

      {/* Image Preview Modal */}
      <Modal visible={modalVisible} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <TouchableOpacity 
            style={styles.modalClose} 
            onPress={() => setModalVisible(false)}
            activeOpacity={1}
          />
          <View style={styles.modalContent}>
            {user?.faceImageUri ? (
              <Image 
                source={{ uri: user.faceImageUri }} 
                style={styles.modalImage} 
                resizeMode="contain" 
              />
            ) : (
              <Text style={typography.h3}>No Image Registered</Text>
            )}
            <TouchableOpacity style={styles.closeBtn} onPress={() => setModalVisible(false)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaWrapper>
  );
};

const SectionCard: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <Card style={styles.sectionCard}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </Card>
);

const DetailRow: React.FC<{ label: string; value: string; last?: boolean }> = ({
  label,
  value,
  last = false,
}) => (
  <View
    style={[
      styles.detailRow,
      !last && { borderBottomWidth: 1, borderBottomColor: colors.border },
    ]}
  >
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailVal}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  fixedHeader: {
    backgroundColor: colors.primary,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    zIndex: 10,
    elevation: 4,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  scroll: { padding: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.xxl },
  avatarSection: { alignItems: 'center', marginBottom: 0 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarText: { fontSize: fs(24), fontWeight: '700', color: colors.primary },
  sectionCard: { marginBottom: spacing.md },
  sectionTitle: {
    fontSize: fs(12),
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
  detailLabel: { ...typography.small },
  detailVal: { ...typography.bodyBold, fontSize: fs(14), maxWidth: '60%', textAlign: 'right' },
  faceCard: { marginBottom: spacing.md },
  faceRow: { flexDirection: 'row', alignItems: 'center' },
  facePrev: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  faceImage: { width: '100%', height: '100%' },
  faceIcon: { fontSize: fs(24) },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' },
  modalClose: { ...StyleSheet.absoluteFillObject },
  modalContent: { width: '85%', backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.xl, alignItems: 'center' },
  modalImage: { width: 300, height: 300, borderRadius: radius.md, marginBottom: spacing.xl, backgroundColor: '#f0f0f0' },
  closeBtn: { backgroundColor: colors.primary, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, borderRadius: radius.md, width: '100%', alignItems: 'center' },
  closeBtnText: { color: colors.white, fontSize: fs(16), fontWeight: '600' as const },
  appInfo: { alignItems: 'center', marginTop: spacing.md },
  appInfoText: { fontSize: fs(11), color: colors.textHint },
});
