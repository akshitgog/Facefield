import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  favTeacher: string;
  password?: string;
  faceRegistered: boolean;
  faceImageUri?: string;
}

export interface AttendanceRecord {
  id: string;
  date: string;        // 'YYYY-MM-DD'
  entryTime?: string;  // 'HH:MM'
  status: 'present' | 'absent' | 'late';
  synced: boolean;
  isPurged?: boolean;
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
  updatePassword: (email: string, password: string) => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
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
      updatePassword: (email: string, password: string) =>
        set((s) => {
          const key = email.trim().toLowerCase();
          const targetUser = s.registeredUsers[key];
          if (!targetUser) return {};
          const updated = { ...targetUser, password };
          return {
            registeredUsers: { ...s.registeredUsers, [key]: updated },
            ...(s.user?.email.trim().toLowerCase() === key ? { user: updated } : {})
          };
        }),
    }),
    {
      name: 'user-storage',
      storage: createJSONStorage(() => AsyncStorage),
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
  syncAndPurgeDemo: () => Promise<number>;
}

const today = () => new Date().toISOString().split('T')[0];

export const useAttendanceStore = create<AttendanceState>()(
  persist(
    (set, get) => ({
      records: [],
      todayRecord: null,

      addRecord: (r) =>
        set((s) => ({
          records: [r, ...s.records],
          todayRecord: r.date === today() ? r : s.todayRecord,
        })),

      setTodayRecord: (r) => set({ todayRecord: r }),

      getHistory: () => {
        const s = get();
        return [...s.records].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
      },

      syncAndPurgeDemo: async () => {
        const s = get();
        const recordsToSync = s.records.filter(r => !r.synced);
        if (recordsToSync.length === 0) return 0;

        // 1. Simulate AWS Network Request
        await new Promise(resolve => setTimeout(resolve, 1500));

        // 2. Mark as Synced & Purge (Local device cleanup)
        set((state) => {
          // Keep the records for the Calendar UI, but mark them as purged.
          // This simulates deleting the heavy logs but keeping the date summary.
          const updatedRecords = state.records.map(r => 
            !r.synced ? { ...r, synced: true, isPurged: true } : r
          );
          return {
            records: updatedRecords
          };
        });

        return recordsToSync.length;
      },
    }),
    {
      name: 'attendance-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
