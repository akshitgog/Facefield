import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';
import type { StateStorage } from 'zustand/middleware';

export function nativeFaceStorage() {
  const storage = NativeModules.FaceAuthSQLite;
  if (!storage?.encryptString || !storage?.saveRegisteredUser) {
    throw new Error('Protected storage is unavailable. Please reinstall the current Android build.');
  }
  return storage;
}

export const hashSecret = (value: string): Promise<string> => nativeFaceStorage().hashSecret(value);
export const verifySecret = (value: string, hash: string): Promise<boolean> =>
  nativeFaceStorage().verifySecret(value, hash);

const pending = new Map<string, Promise<unknown>>();
const writeFailures = new Map<string, unknown>();
function serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
  const result = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  pending.set(key, result);
  void result.finally(() => { if (pending.get(key) === result) pending.delete(key); }).catch(() => {});
  return result;
}

async function migrateCredentials(raw: string): Promise<string> {
  const data = JSON.parse(raw);
  const users = [data.state?.user, ...Object.values(data.state?.registeredUsers ?? {})] as
    Array<Record<string, any> | null>;
  const hashes = new Map<string, string>();
  for (const user of users) {
    if (!user) continue;
    for (const [oldKey, newKey] of [['password', 'passwordHash'], ['favTeacher', 'recoveryAnswerHash']]) {
      if (typeof user[oldKey] === 'string') {
        const value = oldKey === 'favTeacher' ? user[oldKey].trim().toLowerCase() : user[oldKey];
        if (!user[newKey]) {
          let encoded = hashes.get(value);
          if (!encoded) { encoded = await hashSecret(value); hashes.set(value, encoded); }
          user[newKey] = encoded;
        }
        delete user[oldKey];
      }
    }
  }
  return JSON.stringify(data);
}

// No plaintext fallback: a failed migration or lost key is surfaced to the startup UI.
export const secureStorage: StateStorage = {
  getItem: (key) => serialize(key, async () => {
    const stored = await AsyncStorage.getItem(key);
    if (stored === null) return null;
    const native = nativeFaceStorage();
    const encrypted = stored.startsWith('ffenc1:');
    let raw = encrypted ? await native.decryptString(stored, key) : stored;
    if (key === 'user-storage') raw = await migrateCredentials(raw);
    if (!encrypted || key === 'user-storage') {
      await AsyncStorage.setItem(key, await native.encryptString(raw, key));
    }
    return raw;
  }),
  setItem: (key, value) => serialize(key, async () => {
    try {
      const encrypted = await nativeFaceStorage().encryptString(value, key);
      await AsyncStorage.setItem(key, encrypted);
      writeFailures.delete(key);
    } catch (error) {
      writeFailures.set(key, error);
      throw error;
    }
  }),
  removeItem: (key) => serialize(key, () => AsyncStorage.removeItem(key)),
};

export async function flushSecureStorage(): Promise<void> {
  await Promise.allSettled([...pending.values()]);
  if (writeFailures.size) throw [...writeFailures.values()][0];
}
