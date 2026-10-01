import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { secureStorage, hashSecret } from './secureStorage';
import { getAllAttendance } from './embeddingStorage';
import type { AttendanceRecord } from './embeddingStorage';
import { localDateKey } from './localDate';
export type { AttendanceRecord } from './embeddingStorage';

// ── Types ────────────────────────────────────────────────────────────────────
export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  workplace: string;
  age: number;
  idCard: string;
  disability?: string;
  recoveryAnswerHash: string;
  passwordHash: string;
  faceRegistered: boolean;
  faceImageUri?: string;
}

// ── User Store ───────────────────────────────────────────────────────────────
interface UserState {
  user: User | null;
  registeredUsers: Record<string, User>; // lowercase email → User
  isLoggedIn: boolean;
  token: string | null;
  setUser: (u: User) => void;
  setPendingUser: (u: User) => void;
  registerUser: () => void;
  setToken: (t: string) => void;
  logout: () => void;
  setFaceRegistered: (uri?: string) => void;
  updatePassword: (email: string, password: string) => Promise<void>;
}

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      user: null,
      registeredUsers: {},
      isLoggedIn: false,
      token: null,
      setUser: (user) => set({ user, isLoggedIn: true }),
      setPendingUser: (user) => set({ user }),
        registerUser: () =>
          set((s) => {
            if (!s.user) return {};
            const key = s.user.email.trim().toLowerCase();
            return {
              registeredUsers: { ...s.registeredUsers, [key]: { ...s.user, email: s.user.email.trim() } },
            };
          }),
      setToken: (token) => set({ token }),
      logout: () => set({ user: null, isLoggedIn: false, token: null }),
      setFaceRegistered: (uri?: string) =>
        set((s) => ({
          user: s.user ? { ...s.user, faceRegistered: true, faceImageUri: uri } : null,
        })),
      updatePassword: async (email: string, password: string) => {
        const passwordHash = await hashSecret(password);
        const current = get();
        const key = email.trim().toLowerCase();
        const targetUser = current.registeredUsers[key];
        if (!targetUser) throw new Error('Account is unavailable');
        const updated = { ...targetUser, passwordHash };
        const changes = {
          registeredUsers: { ...current.registeredUsers, [key]: updated },
          ...(current.user?.email.trim().toLowerCase() === key ? { user: updated } : {}),
        };
        // Commit credentials before exposing them to login in memory.
        await secureStorage.setItem('user-storage', JSON.stringify({ state: { ...current, ...changes }, version: 0 }));
        set(changes);
      },
    }),
    {
      name: 'user-storage',
      storage: createJSONStorage(() => secureStorage),
      skipHydration: true,
    }
  )
);

// ── Attendance Store ─────────────────────────────────────────────────────────
interface AttendanceState {
  records: AttendanceRecord[];
  todayRecord: AttendanceRecord | null;
  addRecord: (r: AttendanceRecord) => void;
  setTodayRecord: (r: AttendanceRecord | null) => void;
  getHistory: () => AttendanceRecord[];
  loadRecords: () => Promise<void>;
  syncAndPurgeDemo: () => Promise<number>;
}

const today = localDateKey;

export const useAttendanceStore = create<AttendanceState>()(
    (set, get) => ({
      records: [],
      todayRecord: null,

      addRecord: (r) =>
        set((s) => ({
          records: [r, ...s.records.filter((old) => old.id !== r.id)],
          todayRecord: r.date === today() && r.userId === useUserStore.getState().user?.id ? r : s.todayRecord,
        })),

      setTodayRecord: (r) => set({ todayRecord: r }),

      loadRecords: async () => {
        const records = await getAllAttendance();
        set({ records, todayRecord: records.find((r) => r.date === today() && r.userId === useUserStore.getState().user?.id) ?? null });
      },

      getHistory: () => {
        const s = get();
        return s.records.filter((r) => r.userId === useUserStore.getState().user?.id).sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
      },

      syncAndPurgeDemo: async () => {
        throw new Error('AWS sync is not configured. Local records have not been purged.');
      },
    })
);
