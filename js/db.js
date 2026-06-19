// db.js — local storage layer, built on IndexedDB.
//
// Design goals (directly fixing problems from the old single-file version):
//   1. Every write either succeeds or throws — callers always know what happened.
//      Nothing is ever silently swallowed.
//   2. One database, a few clearly-named object stores. No more guessing which
//      string key holds which JSON blob.
//   3. Pure functions with no UI code mixed in, so this file can be tested on
//      its own and reused by every screen.

const DB_NAME = "jee_exam_app";
const DB_VERSION = 1;

const STORES = {
  PAPERS: "papers",       // imported question papers (Main + Advanced)
  SESSIONS: "sessions",   // in-progress exam state (for resume / exit-and-continue)
  HISTORY: "history",     // completed attempt records, used by Progress screen
  SETTINGS: "settings",   // small key/value app settings
};

let _dbPromise = null;

/**
 * Opens (or creates) the database. Cached so every caller shares one
 * connection instead of re-opening it constantly.
 */
function openDB() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORES.PAPERS)) {
        db.createObjectStore(STORES.PAPERS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.SESSIONS)) {
        db.createObjectStore(STORES.SESSIONS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.HISTORY)) {
        const historyStore = db.createObjectStore(STORES.HISTORY, { keyPath: "id" });
        historyStore.createIndex("by_date", "date");
        historyStore.createIndex("by_mode", "mode");
      }
      if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
        db.createObjectStore(STORES.SETTINGS, { keyPath: "key" });
      }
    };

    req.onsuccess = (event) => resolve(event.target.result);
    req.onerror = (event) => reject(new Error("Failed to open database: " + event.target.error));
    req.onblocked = () => reject(new Error("Database open blocked — close other tabs running this app."));
  });

  return _dbPromise;
}

/**
 * Runs a transaction against a single store, returning a Promise.
 * `mode` is "readonly" or "readwrite". `work` receives the object store
 * and must return the IDBRequest it wants the result of.
 */
function runTx(storeName, mode, work) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;

      tx.oncomplete = () => resolve(result);
      tx.onerror = (event) => reject(new Error(`Transaction failed on "${storeName}": ` + event.target.error));
      tx.onabort = (event) => reject(new Error(`Transaction aborted on "${storeName}": ` + event.target.error));

      const req = work(store);
      req.onsuccess = (event) => { result = event.target.result; };
      req.onerror = (event) => reject(new Error(`Request failed on "${storeName}": ` + event.target.error));
    });
  });
}

// ── Generic CRUD, reused by every store above ────────────────────────────────

async function put(storeName, value) {
  await runTx(storeName, "readwrite", (store) => store.put(value));
  return value;
}

async function get(storeName, id) {
  const result = await runTx(storeName, "readonly", (store) => store.get(id));
  return result === undefined ? null : result;
}

async function getAll(storeName) {
  const result = await runTx(storeName, "readonly", (store) => store.getAll());
  return result || [];
}

async function remove(storeName, id) {
  await runTx(storeName, "readwrite", (store) => store.delete(id));
}

// ── Public API, organized by what the app actually needs ────────────────────

export const PapersDB = {
  save: (paper) => put(STORES.PAPERS, paper),
  get: (id) => get(STORES.PAPERS, id),
  getAll: () => getAll(STORES.PAPERS),
  delete: (id) => remove(STORES.PAPERS, id),
};

export const SessionsDB = {
  // id is a fixed string per exam slot, e.g. "main", "adv_p1", "adv_p2"
  save: (session) => put(STORES.SESSIONS, session),
  get: (id) => get(STORES.SESSIONS, id),
  delete: (id) => remove(STORES.SESSIONS, id),
};

export const HistoryDB = {
  add: (entry) => {
    const record = { id: `${entry.mode}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, ...entry };
    return put(STORES.HISTORY, record);
  },
  getAll: () => getAll(STORES.HISTORY),
  getByMode: async (mode) => {
    const all = await getAll(STORES.HISTORY);
    return all.filter((e) => e.mode === mode);
  },
  delete: (id) => remove(STORES.HISTORY, id),
  clear: async () => {
    const all = await getAll(STORES.HISTORY);
    await Promise.all(all.map((e) => remove(STORES.HISTORY, e.id)));
  },
};

export const SettingsDB = {
  set: (key, value) => put(STORES.SETTINGS, { key, value }),
  get: async (key) => {
    const row = await get(STORES.SETTINGS, key);
    return row ? row.value : null;
  },
};

// Exposed for diagnostics/debugging from the browser console if something
// ever looks wrong — e.g. `await DB.debugDump()` in devtools.
export const DB = {
  debugDump: async () => ({
    papers: await getAll(STORES.PAPERS),
    sessions: await getAll(STORES.SESSIONS),
    history: await getAll(STORES.HISTORY),
    settings: await getAll(STORES.SETTINGS),
  }),
};
