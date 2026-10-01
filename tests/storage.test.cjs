const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');

// Exercise the actual TS storage code with explicit native/AsyncStorage contracts.
// Native Keystore behavior is not simulated as a device test.
function harness() {
  const disk = new Map();
  const users = {};
  const key = crypto.randomBytes(32);
  const control = { failDisk: false, failNative: false, failDecrypt: false, saves: 0 };
  const native = {
    encryptString: async (value, purpose) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(purpose));
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return 'ffenc1:' + [iv, encrypted, cipher.getAuthTag()].map(b => b.toString('base64')).join(':');
    },
    decryptString: async (value, purpose) => {
      if (control.failDecrypt) throw Error('key unavailable');
      const [iv, data, tag] = value.slice(7).split(':').map(v => Buffer.from(v, 'base64'));
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(purpose));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    },
    hashSecret: async v => 'test-hash:' + crypto.createHash('sha256').update(v).digest('hex'),
    verifySecret: async (v, hash) => hash === await native.hashSecret(v),
    saveRegisteredUser: async json => {
      if (control.failNative) throw Error('native transaction failed');
      const user = JSON.parse(json);
      users[user.userId] = user;
      control.saves++;
    },
    getRegisteredUsers: async () => JSON.stringify(users),
    deleteEmbedding: async id => { if (control.failNative) throw Error('native delete failed'); delete users[id]; },
  };
  const asyncStorage = {
    getItem: async key => disk.get(key) ?? null,
    setItem: async (key, value) => { if (control.failDisk) throw Error('disk full'); disk.set(key, value); },
    removeItem: async key => { if (control.failDisk) throw Error('disk full'); disk.delete(key); },
  };
  const modules = new Map();
  function load(filename) {
    filename = path.resolve(__dirname, '..', filename);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    const localRequire = name => {
      if (name === '@react-native-async-storage/async-storage') return asyncStorage;
      if (name === 'react-native') return { NativeModules: { FaceAuthSQLite: native } };
      if (name.startsWith('.')) return load(path.join(path.dirname(filename), name + '.ts'));
      return require(name);
    };
    vm.runInThisContext('(function(require,module,exports){' + output + '\n})', { filename })(localRequire, module, module.exports);
    return module.exports;
  }
  return { disk, users, control, native, ...load('client/store/secureStorage.ts'), ...load('client/store/embeddingStorage.ts'), ...load('client/store/localDate.ts'), ...load('client/store/index.ts') };
}
const record = (userId, id = 'first', date = '2026-10-01') => ({ id, userId, date, status: 'present', entryTime: '09:00', synced: false });
const user = (userId = 'a') => ({ userId, name: 'Test', email: 'test@example.com', embedding: [0.5, 0.5], registeredAt: 'now' });

test('concurrent attendance accepts one durable record per user/local day', async () => {
  const h = harness();
  const saved = await Promise.all(Array.from({ length: 20 }, (_, i) => h.saveAttendance(record('a', String(i)))));
  assert.equal(new Set(saved.map(r => r.id)).size, 1);
  assert.equal((await h.getAllAttendance()).length, 1);
  await h.saveAttendance(record('b', 'other'));
  await h.saveAttendance(record('a', 'tomorrow', '2026-10-02'));
  assert.equal((await h.getAllAttendance()).length, 3);
  assert.ok(h.disk.get('@datalake_attendance').startsWith('ffenc1:'));
  assert.ok(!h.disk.get('@datalake_attendance').includes('09:00'));
});
test('failed attendance write rejects and retry queue recovers without phantom record', async () => {
  const h = harness();
  h.control.failDisk = true;
  await assert.rejects(h.saveAttendance(record('a')), /disk full/);
  assert.equal((await h.getAllAttendance()).length, 0);
  await assert.rejects(h.flushSecureStorage(), /disk full/);
  h.control.failDisk = false;
  await h.saveAttendance(record('a'));
  await h.flushSecureStorage();
  assert.equal((await h.getAllAttendance()).length, 1);
});
test('settled fire-and-forget persist failures remain visible to flush', async () => {
  const h = harness();
  h.control.failDisk = true;
  await assert.rejects(h.secureStorage.setItem('user-storage', '{}'));
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(h.flushSecureStorage(), /disk full/);
});
test('native enrollment and deletion are awaited and failures propagate', async () => {
  const h = harness();
  h.control.failNative = true;
  await assert.rejects(h.saveEmbedding(user()), /transaction failed/);
  assert.equal(Object.keys(await h.getAllEmbeddings()).length, 0);
  h.control.failNative = false;
  await h.saveEmbedding(user());
  assert.ok((await h.getAllEmbeddings()).a);
  h.control.failNative = true;
  await assert.rejects(h.deleteEmbedding('a'), /delete failed/);
  assert.ok((await h.getAllEmbeddings()).a);
  h.control.failNative = false;
  await h.deleteEmbedding('a');
  assert.equal(Object.keys(await h.getAllEmbeddings()).length, 0);
});
test('nonfinite/empty embeddings never reach native persistence', async () => {
  const h = harness();
  for (const embedding of [[], [NaN], [Infinity]]) await assert.rejects(h.saveEmbedding({ ...user(), embedding }));
  assert.equal(h.control.saves, 0);
});
test('migration preserves newer native enrollment and removes legacy only after commit', async () => {
  const h = harness();
  h.users.a = { ...user(), name: 'Newer' };
  h.disk.set('@datalake_embeddings', JSON.stringify({ a: user(), b: user('b') }));
  h.control.failNative = true;
  await assert.rejects(h.getAllEmbeddings());
  assert.ok(h.disk.has('@datalake_embeddings'));
  h.control.failNative = false;
  const users = await h.getAllEmbeddings();
  assert.equal(users.a.name, 'Newer');
  assert.ok(users.b);
  assert.ok(!h.disk.has('@datalake_embeddings'));
});
test('legacy credentials become hashes and encrypted data without plaintext fields', async () => {
  const h = harness();
  h.disk.set('user-storage', JSON.stringify({ state: { user: { password: 'secret123', favTeacher: ' Teacher ' } } }));
  const migrated = JSON.parse(await h.secureStorage.getItem('user-storage')).state.user;
  assert.equal(migrated.password, undefined);
  assert.equal(migrated.favTeacher, undefined);
  assert.ok(await h.verifySecret('secret123', migrated.passwordHash));
  assert.ok(await h.verifySecret('teacher', migrated.recoveryAnswerHash));
  assert.equal(await h.verifySecret('wrong', migrated.passwordHash), false);
  assert.ok(!h.disk.get('user-storage').includes('secret123'));
});
test('key/decryption failure never overwrites existing ciphertext', async () => {
  const h = harness();
  await h.secureStorage.setItem('private', 'preserve me');
  const before = h.disk.get('private');
  h.control.failDecrypt = true;
  await assert.rejects(h.secureStorage.getItem('private'), /key unavailable/);
  assert.equal(h.disk.get('private'), before);
});
test('attendance migration merges records idempotently', async () => {
  const h = harness();
  await h.saveAttendance(record('a'));
  h.disk.set('attendance-storage', JSON.stringify({ state: { records: [record('a'), record('b', 'second')] } }));
  await h.migrateAttendance();
  await h.migrateAttendance();
  assert.equal((await h.getAllAttendance()).length, 2);
  assert.ok(!h.disk.has('attendance-storage'));
});
test('local date follows Asia/Calcutta midnight rather than UTC', () => {
  const oldZone = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Calcutta';
    const h = harness();
    assert.equal(h.localDateKey(new Date('2026-09-30T19:00:00Z')), '2026-10-01');
    assert.equal(h.localDateKey(new Date('2026-09-30T18:29:00Z')), '2026-09-30');
  } finally { if (oldZone === undefined) delete process.env.TZ; else process.env.TZ = oldZone; }
});
test('committed enrollment recovers account after interrupted registry save', () => {
  const h = harness();
  const account = { id: 'a', email: 'test@example.com', passwordHash: 'hashed', faceRegistered: false };
  const recovered = h.reconcileEnrollments({}, { a: { ...user(), account } });
  assert.equal(recovered[account.email].faceRegistered, true);
  assert.equal(recovered[account.email].passwordHash, 'hashed');
});
test('enrollment recovery cannot undo password reset or attach another account', () => {
  const h = harness();
  const current = { id: 'a', email: 'test@example.com', passwordHash: 'new-hash', faceRegistered: false };
  const enrollments = { a: { ...user(), account: { ...current, passwordHash: 'old-hash' } } };
  assert.equal(h.reconcileEnrollments({ [current.email]: current }, enrollments)[current.email].passwordHash, 'new-hash');
  const other = { ...current, id: 'b' };
  assert.equal(h.reconcileEnrollments({ [current.email]: other }, enrollments)[current.email].id, 'b');
});
test('removed native enrollment clears stale face-registration UI state', () => {
  const h = harness();
  const account = { id: 'a', email: 'test@example.com', passwordHash: 'hashed', faceRegistered: true };
  assert.equal(h.reconcileEnrollments({ [account.email]: account }, {})[account.email].faceRegistered, false);
});
test('password reset write failure cannot change credentials in memory', async () => {
  const h = harness();
  const account = { id: 'a', email: 'test@example.com', passwordHash: await h.hashSecret('old-password'), faceRegistered: true };
  h.useUserStore.setState({ registeredUsers: { [account.email]: account }, user: account });
  await h.flushSecureStorage();
  h.control.failDisk = true;
  await assert.rejects(h.useUserStore.getState().updatePassword(account.email, 'new-password'), /disk full/);
  assert.equal(h.useUserStore.getState().user.passwordHash, account.passwordHash);
  h.control.failDisk = false;
  await h.useUserStore.getState().updatePassword(account.email, 'new-password');
  await h.flushSecureStorage();
  const saved = JSON.parse(await h.secureStorage.getItem('user-storage')).state.user;
  assert.ok(await h.verifySecret('new-password', saved.passwordHash));
});
test('history never leaks another user attendance', async () => {
  const h = harness();
  h.useUserStore.setState({ user: { id: 'a' } });
  h.useAttendanceStore.getState().addRecord(record('a'));
  h.useAttendanceStore.getState().addRecord(record('b', 'other'));
  assert.equal(h.useAttendanceStore.getState().getHistory().length, 1);
  assert.equal(h.useAttendanceStore.getState().getHistory()[0].userId, 'a');
  await h.flushSecureStorage();
});
test('SQLite secure-delete PRAGMA uses a result cursor, not execSQL', () => {
  const source = fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/com/datalakeauth/plugin/EmbeddingDatabaseHelper.kt'), 'utf8');
  assert.doesNotMatch(source, /execSQL\("PRAGMA secure_delete/);
  assert.match(source, /rawQuery\("PRAGMA secure_delete=ON", null\)\.use/);
  assert.match(source, /cursor\.moveToFirst\(\) && cursor\.getInt\(0\) == 1/);
});
