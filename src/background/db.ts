/**
 * IndexedDB persistence for the current session.
 *
 * - `events`: append-only store (auto-increment key) so each batch is O(batch), not O(session).
 * - `shots`:  screenshot data URLs keyed by screenshot id.
 *
 * chrome.storage.local only holds the small session meta + counters.
 */
import type { SessionEvent } from "../shared/schema";

const DB_NAME = "wr_db";
const EVENTS = "events";
const SHOTS = "shots";
const VERSION = 1;

/** Pre-0.2 database; deleted on install/upgrade. */
export const LEGACY_DB_NAME = "wr_screenshots";

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(EVENTS)) db.createObjectStore(EVENTS, { autoIncrement: true });
      if (!db.objectStoreNames.contains(SHOTS)) db.createObjectStore(SHOTS);
    };
    req.onsuccess = () => {
      const db = req.result;
      // If another context bumps the version, drop our cached handle so we re-open.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
};

const tx = async (store: string, mode: IDBTransactionMode): Promise<IDBObjectStore> => {
  const db = await openDb();
  return db.transaction(store, mode).objectStore(store);
};

const done = (t: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });

const request = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

// ----- events -----

export const putEvents = async (events: SessionEvent[]): Promise<void> => {
  if (events.length === 0) return;
  const store = await tx(EVENTS, "readwrite");
  for (const e of events) store.add(e);
  await done(store.transaction);
};

export const getAllEvents = async (): Promise<SessionEvent[]> => {
  const store = await tx(EVENTS, "readonly");
  return request(store.getAll() as IDBRequest<SessionEvent[]>);
};

export const clearEvents = async (): Promise<void> => {
  const store = await tx(EVENTS, "readwrite");
  store.clear();
  await done(store.transaction);
};

// ----- screenshots -----

export const putShot = async (id: string, dataUrl: string): Promise<void> => {
  const store = await tx(SHOTS, "readwrite");
  store.put(dataUrl, id);
  await done(store.transaction);
};

export const getAllShots = async (): Promise<Record<string, string>> => {
  const store = await tx(SHOTS, "readonly");
  const [keys, values] = await Promise.all([
    request(store.getAllKeys()),
    request(store.getAll() as IDBRequest<string[]>),
  ]);
  const out: Record<string, string> = {};
  keys.forEach((k, i) => {
    out[String(k)] = values[i]!;
  });
  return out;
};

export const clearShots = async (): Promise<void> => {
  const store = await tx(SHOTS, "readwrite");
  store.clear();
  await done(store.transaction);
};

export const clearAll = async (): Promise<void> => {
  await Promise.all([clearEvents(), clearShots()]);
};

export const deleteLegacyDb = (): void => {
  try {
    indexedDB.deleteDatabase(LEGACY_DB_NAME);
  } catch {
    // best effort
  }
};
