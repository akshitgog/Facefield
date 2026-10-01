import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Button, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './frontend/navigation/RootNavigator';
import { useUserStore, useAttendanceStore } from './frontend/store';
import { secureStorage, flushSecureStorage } from './frontend/store/secureStorage';
import { getAllEmbeddings, migrateAttendance, reconcileEnrollments } from './frontend/store/embeddingStorage';

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let mounted = true;
    let stage = 'credentials';
    setError(false);
    (async () => {
      // Read explicitly first so failed key access/migration cannot silently hydrate an empty store.
      await secureStorage.getItem('user-storage');
      await useUserStore.persist.rehydrate();
      stage = 'enrollments';
      const enrollments = await getAllEmbeddings();
      const state = useUserStore.getState();
      // Recover a committed enrollment if the process stopped before the JS registry save.
      // Existing credentials win, so a password reset cannot be undone by this snapshot.
      const registeredUsers = reconcileEnrollments(state.registeredUsers, enrollments);
      const user = state.user ? registeredUsers[state.user.email.trim().toLowerCase()] ?? state.user : null;
      useUserStore.setState({ registeredUsers, user });
      stage = 'attendance';
      await migrateAttendance();
      await useAttendanceStore.getState().loadRecords();
      stage = 'persist';
      await flushSecureStorage();
      if (mounted) setReady(true);
    })().catch((cause: unknown) => {
      // Log only the checkpoint and bridge error code, never local account data.
      const code = typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : 'UNKNOWN';
      console.warn(`[FaceFieldStorage] Startup failed at ${stage} (${code})`);
      if (mounted) setError(true);
    });
    return () => { mounted = false; };
  }, [attempt]);
  return (
    <SafeAreaProvider>
      {ready ? <RootNavigator /> : (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          {error ? <>
            <Text>Unable to open protected local data. Your saved data has been preserved.</Text>
            <Button title="Retry" onPress={() => setAttempt((value) => value + 1)} />
          </> : <ActivityIndicator size="large" />}
        </View>
      )}
    </SafeAreaProvider>
  );
}
