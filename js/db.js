// IndexedDB storage. Audio is stored as ArrayBuffer (most robust on iOS Safari).
//   tunes:    metadata {id, name, createdAt, bpm, sa, duration, mimeType, size}
//   audio:    {id, type, data: ArrayBuffer}
//   sessions: in-progress recordings (for crash / interruption recovery)
//   chunks:   {session, seq, elapsed, data} pieces of an in-progress recording

const DB_NAME = 'tune-notebook';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tunes')) db.createObjectStore('tunes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chunks')) {
        const c = db.createObjectStore('chunks', { autoIncrement: true });
        c.createIndex('session', 'session');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => { dbPromise = null; reject(new Error('Database blocked by another tab')); };
  });
  return dbPromise;
}

// Run `body(tx)` in one transaction; resolves with body's return value (or the
// result of the IDBRequest it returns) once the transaction commits.
// Retries once if Safari dropped the connection (happens after long suspends).
async function run(stores, mode, body) {
  for (let attempt = 0; ; attempt++) {
    try {
      const db = await open();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        let out;
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new DOMException('Transaction aborted', 'AbortError'));
        const r = body(tx);
        if (r instanceof IDBRequest) r.onsuccess = () => { out = r.result; };
        else out = r;
      });
    } catch (e) {
      if (attempt === 0 && (e.name === 'InvalidStateError' || e.name === 'UnknownError')) {
        dbPromise = null;
        continue;
      }
      throw e;
    }
  }
}

export async function listTunes() {
  const all = await run(['tunes'], 'readonly', (tx) => tx.objectStore('tunes').getAll());
  return (all || []).sort((a, b) => b.createdAt - a.createdAt);
}

export const getAudio = (id) => run(['audio'], 'readonly', (tx) => tx.objectStore('audio').get(id));

export const saveTune = (meta, data) =>
  run(['tunes', 'audio'], 'readwrite', (tx) => {
    tx.objectStore('audio').put({ id: meta.id, type: meta.mimeType, data });
    tx.objectStore('tunes').put(meta);
  });

export const updateTune = (meta) => run(['tunes'], 'readwrite', (tx) => { tx.objectStore('tunes').put(meta); });

export const deleteTune = (id) =>
  run(['tunes', 'audio'], 'readwrite', (tx) => {
    tx.objectStore('tunes').delete(id);
    tx.objectStore('audio').delete(id);
  });

// --- in-progress recording sessions ---
export const putSession = (s) => run(['sessions'], 'readwrite', (tx) => { tx.objectStore('sessions').put(s); });
export const getSessions = () => run(['sessions'], 'readonly', (tx) => tx.objectStore('sessions').getAll());
export const addChunk = (chunk) => run(['chunks'], 'readwrite', (tx) => { tx.objectStore('chunks').add(chunk); });

export async function getChunks(sessionId) {
  const list = await run(['chunks'], 'readonly', (tx) => tx.objectStore('chunks').index('session').getAll(sessionId));
  return (list || []).sort((a, b) => a.seq - b.seq);
}

export const deleteSession = (sessionId) =>
  run(['sessions', 'chunks'], 'readwrite', (tx) => {
    tx.objectStore('sessions').delete(sessionId);
    const store = tx.objectStore('chunks');
    const req = store.index('session').getAllKeys(sessionId);
    req.onsuccess = () => { for (const k of req.result) store.delete(k); };
  });
