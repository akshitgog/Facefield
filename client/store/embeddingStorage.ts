/**
 * embeddingStorage.ts
 *
 * Local storage for face embeddings and attendance records using SQLite.
 *
 * In production, use react-native-sqlite-storage or expo-sqlite.
 * For the hackathon demo, we use AsyncStorage as a lightweight
 * JSON-based store that works offline without any native setup.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';

// ─────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────

export type StoredUser = {
  userId: string;
  name: string;
  email: string;
  embedding: number[]; // L2-normalized average embedding
  faceImageUri?: string;
  registeredAt: string;
};

export type AttendanceRecord = {
  id: string;
  userId: string;
  date: string;
  entryTime: string;
  exitTime?: string;
  status: 'present' | 'absent';
  synced: boolean;
};

// ─────────────────────────────────────────────────────
// Embedding Storage (Registration)
// ─────────────────────────────────────────────────────

const EMBEDDINGS_KEY = '@datalake_embeddings';

/**
 * Stores a user's face embedding after registration.
 */
export async function saveEmbedding(user: StoredUser): Promise<void> {
  const existing = await getAllEmbeddings();
  existing[user.userId] = user;
  await AsyncStorage.setItem(EMBEDDINGS_KEY, JSON.stringify(existing));
  
  // Sync directly to Native SQLite for offline FaceAuth inference
  if (NativeModules.FaceAuthSQLite) {
    try {
      NativeModules.FaceAuthSQLite.saveEmbedding(user.userId, Array.from(user.embedding));
    } catch (e) {
      console.log('Failed to sync embedding to Native SQLite', e);
    }
  }
}

/**
 * Retrieves all stored embeddings as a map of userId → StoredUser.
 */
export async function getAllEmbeddings(): Promise<Record<string, StoredUser>> {
  const raw = await AsyncStorage.getItem(EMBEDDINGS_KEY);
  if (!raw) return {};
  return JSON.parse(raw);
}

/**
 * Retrieves all embeddings as a flat map of userId → number[]
 * for passing to the native Kotlin pipeline.
 */
export async function getEmbeddingsForNative(): Promise<Record<string, number[]>> {
  const users = await getAllEmbeddings();
  const result: Record<string, number[]> = {};
  for (const [userId, user] of Object.entries(users)) {
    result[userId] = user.embedding;
  }
  return result;
}

/**
 * Deletes a specific user's embedding.
 */
export async function deleteEmbedding(userId: string): Promise<void> {
  const existing = await getAllEmbeddings();
  delete existing[userId];
  await AsyncStorage.setItem(EMBEDDINGS_KEY, JSON.stringify(existing));
}

// ─────────────────────────────────────────────────────
// Attendance Storage (Marking)
// ─────────────────────────────────────────────────────

const ATTENDANCE_KEY = '@datalake_attendance';

/**
 * Saves an attendance record locally.
 */
export async function saveAttendance(record: AttendanceRecord): Promise<void> {
  const existing = await getAllAttendance();
  existing.push(record);
  await AsyncStorage.setItem(ATTENDANCE_KEY, JSON.stringify(existing));
}

/**
 * Retrieves all stored attendance records.
 */
export async function getAllAttendance(): Promise<AttendanceRecord[]> {
  const raw = await AsyncStorage.getItem(ATTENDANCE_KEY);
  if (!raw) return [];
  return JSON.parse(raw);
}

/**
 * Gets unsynced attendance records (for AWS sync).
 */
export async function getUnsyncedAttendance(): Promise<AttendanceRecord[]> {
  const all = await getAllAttendance();
  return all.filter((r) => !r.synced);
}

/**
 * Marks records as synced after successful AWS upload.
 */
export async function markAsSynced(ids: string[]): Promise<void> {
  const all = await getAllAttendance();
  const updated = all.map((r) =>
    ids.includes(r.id) ? { ...r, synced: true } : r
  );
  await AsyncStorage.setItem(ATTENDANCE_KEY, JSON.stringify(updated));
}

/**
 * Purges all synced records (AWS Sync & Purge mechanism).
 */
export async function purgeSyncedRecords(): Promise<number> {
  const all = await getAllAttendance();
  const unsynced = all.filter((r) => !r.synced);
  const purgedCount = all.length - unsynced.length;
  await AsyncStorage.setItem(ATTENDANCE_KEY, JSON.stringify(unsynced));
  return purgedCount;
}

/**
 * Gets today's attendance record for the current user.
 */
export async function getTodayRecord(userId: string): Promise<AttendanceRecord | null> {
  const today = new Date().toISOString().split('T')[0];
  const all = await getAllAttendance();
  return all.find((r) => r.userId === userId && r.date === today) || null;
}
