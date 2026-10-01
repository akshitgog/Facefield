import { nativeFaceStorage, secureStorage } from './secureStorage';
import { localDateKey } from './localDate';
import type { User } from './index';

export type StoredUser = {
  userId: string;
  name: string;
  email: string;
  embedding: number[];
  faceImageUri?: string;
  registeredAt: string;
  // Durable recovery snapshot committed in the same native transaction as the face.
  account?: User;
};

export type AttendanceRecord = {
  id: string;
  userId: string;
  date: string;
  entryTime?: string;
  exitTime?: string;
  status: 'present' | 'absent' | 'late';
  synced: boolean;
  isPurged?: boolean;
};

const EMBEDDINGS_KEY = '@datalake_embeddings';
const ATTENDANCE_KEY = '@datalake_attendance';
let enrollmentQueue: Promise<unknown> = Promise.resolve();
let attendanceQueue: Promise<unknown> = Promise.resolve();

function enrollmentOperation<T>(work: () => Promise<T>): Promise<T> {
  const result = enrollmentQueue.catch(() => {}).then(work);
  enrollmentQueue = result;
  return result;
}

export function attendanceOperation<T>(work: () => Promise<T>): Promise<T> {
  const result = attendanceQueue.catch(() => {}).then(work);
  attendanceQueue = result;
  return result;
}

async function migrateEnrollments(): Promise<void> {
  const legacy = await secureStorage.getItem(EMBEDDINGS_KEY);
  if (!legacy) return;
  const native = nativeFaceStorage();
  const registered = JSON.parse(await native.getRegisteredUsers()) as Record<string, StoredUser>;
  for (const user of Object.values(JSON.parse(legacy)) as StoredUser[]) {
    if (!registered[user.userId]) await native.saveRegisteredUser(JSON.stringify(user));
  }
  // Remove only after every native transaction commits. Retries are idempotent.
  await secureStorage.removeItem(EMBEDDINGS_KEY);
}

export function saveEmbedding(user: StoredUser): Promise<void> {
  return enrollmentOperation(async () => {
    if (!user.embedding.length || !user.embedding.every(Number.isFinite)) throw new Error('Invalid embedding');
    await migrateEnrollments();
    // Embedding and UI metadata commit together in native SQLite.
    await nativeFaceStorage().saveRegisteredUser(JSON.stringify(user));
  });
}

/** Recover cross-store interruptions without restoring an old password snapshot. */
export function reconcileEnrollments(registeredUsers: Record<string, User>, enrollments: Record<string, StoredUser>): Record<string, User> {
  const recovered = { ...registeredUsers };
  for (const enrollment of Object.values(enrollments)) {
    const account = enrollment.account;
    if (!account || account.id !== enrollment.userId || !account.passwordHash) continue;
    const email = account.email.trim().toLowerCase();
    const previous = recovered[email];
    if (previous && previous.id !== account.id) continue;
    recovered[email] = { ...(previous ?? account), faceRegistered: true, faceImageUri: enrollment.faceImageUri };
  }
  for (const [email, account] of Object.entries(recovered)) {
    if (!enrollments[account.id]) recovered[email] = { ...account, faceRegistered: false, faceImageUri: undefined };
  }
  return recovered;
}

export function getAllEmbeddings(): Promise<Record<string, StoredUser>> {
  return enrollmentOperation(async () => {
    await migrateEnrollments();
    return JSON.parse(await nativeFaceStorage().getRegisteredUsers());
  });
}

export async function getEmbeddingsForNative(): Promise<Record<string, number[]>> {
  const users = await getAllEmbeddings();
  return Object.fromEntries(Object.entries(users).map(([id, user]) => [id, user.embedding]));
}

export function deleteEmbedding(userId: string): Promise<void> {
  return enrollmentOperation(async () => {
    await migrateEnrollments();
    await nativeFaceStorage().deleteEmbedding(userId);
  });
}

export async function getAllAttendance(): Promise<AttendanceRecord[]> {
  const raw = await secureStorage.getItem(ATTENDANCE_KEY);
  return raw ? JSON.parse(raw) : [];
}

/** Serializes check-and-save so repeated events/scans cannot create duplicates. */
export function saveAttendance(record: AttendanceRecord): Promise<AttendanceRecord> {
  return attendanceOperation(async () => {
    const records = await getAllAttendance();
    const previous = records.find((r) => r.userId === record.userId && r.date === record.date);
    if (previous) return previous;
    await secureStorage.setItem(ATTENDANCE_KEY, JSON.stringify([...records, record]));
    return record;
  });
}

export async function migrateAttendance(): Promise<void> {
  await attendanceOperation(async () => {
    const legacy = await secureStorage.getItem('attendance-storage');
    const records = await getAllAttendance();
    if (legacy) {
      const oldRecords = JSON.parse(legacy).state?.records ?? [];
      const ids = new Set(records.map((r) => r.id));
      for (const old of oldRecords) {
        if (!ids.has(old.id)) { records.push(old); ids.add(old.id); }
      }
      await secureStorage.setItem(ATTENDANCE_KEY, JSON.stringify(records));
      await secureStorage.removeItem('attendance-storage');
    }
  });
}

export async function getUnsyncedAttendance(): Promise<AttendanceRecord[]> {
  return (await getAllAttendance()).filter((r) => !r.synced);
}

export function markAsSynced(ids: string[]): Promise<void> {
  return attendanceOperation(async () => {
    const records = await getAllAttendance();
    await secureStorage.setItem(ATTENDANCE_KEY, JSON.stringify(records.map((r) =>
      ids.includes(r.id) ? { ...r, synced: true, isPurged: true } : r)));
  });
}

export function purgeSyncedRecords(): Promise<number> {
  return attendanceOperation(async () => {
    const records = await getAllAttendance();
    const retained = records.filter((r) => !r.synced);
    await secureStorage.setItem(ATTENDANCE_KEY, JSON.stringify(retained));
    return records.length - retained.length;
  });
}

export async function getTodayRecord(userId: string): Promise<AttendanceRecord | null> {
  return (await getAllAttendance()).find((r) => r.userId === userId && r.date === localDateKey()) ?? null;
}
