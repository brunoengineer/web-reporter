import {
  accumulateStats,
  emptyStats,
  type NoteEvent,
  type SessionEvent,
  type SessionMeta,
  type SessionState,
  type SessionStats,
} from "../shared/schema";
import type { StartPayload } from "../shared/messages";
import { loadSettings } from "../shared/settingsStore";
import { clearAll, putEvents } from "./db";
import { setBadge } from "./badge";

export const SESSION_KEY = "wr.session";
export const STATS_KEY = "wr.stats";

const appVersion = (): string => {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "";
  }
};

// All mutations go through a promise chain so concurrent messages (content script batches,
// popup clicks, keyboard commands) never interleave their read-modify-write cycles.
let chain: Promise<unknown> = Promise.resolve();

const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
};

export const loadSession = async (): Promise<SessionMeta | null> => {
  const data = await chrome.storage.local.get(SESSION_KEY);
  return (data[SESSION_KEY] as SessionMeta | undefined) ?? null;
};

export const loadStats = async (): Promise<SessionStats> => {
  const data = await chrome.storage.local.get(STATS_KEY);
  return { ...emptyStats(), ...((data[STATS_KEY] as Partial<SessionStats> | undefined) ?? {}) };
};

export const getState = async (): Promise<SessionState> => {
  const cur = await loadSession();
  return cur?.state ?? "idle";
};

export const startSession = (input: StartPayload): Promise<SessionMeta> =>
  serialize(async () => {
    const meta: SessionMeta = {
      id: crypto.randomUUID(),
      state: "recording",
      startedAt: Date.now(),
      title: input.title,
      severity: input.severity,
      notes: input.notes,
      tab: input.tab,
      appVersion: appVersion(),
    };
    await clearAll();
    await chrome.storage.local.set({ [SESSION_KEY]: meta, [STATS_KEY]: emptyStats() });
    await setBadge("recording");
    return meta;
  });

export const stopSession = (): Promise<SessionMeta | null> =>
  serialize(async () => {
    const cur = await loadSession();
    await chrome.storage.local.remove([SESSION_KEY, STATS_KEY]);
    await clearAll();
    await setBadge("idle");
    return cur;
  });

export const updateMeta = (patch: Partial<SessionMeta>): Promise<SessionMeta | null> =>
  serialize(async () => {
    const cur = await loadSession();
    if (!cur) return null;
    const next: SessionMeta = { ...cur, ...patch };
    await chrome.storage.local.set({ [SESSION_KEY]: next });
    return next;
  });

export const setSessionState = (state: SessionState): Promise<SessionMeta | null> =>
  updateMeta({ state });

/** Mark the recorded tab as closed; the session is kept so the user can still export. */
export const markTabClosed = (tabId: number): Promise<SessionMeta | null> =>
  serialize(async () => {
    const cur = await loadSession();
    if (!cur || !cur.tab || cur.tab.id !== tabId) return cur;
    const next: SessionMeta = { ...cur, tab: { ...cur.tab, closed: true } };
    await chrome.storage.local.set({ [SESSION_KEY]: next });
    return next;
  });

/**
 * Append events to the active session.
 * @param fromTabId tab the events came from; `undefined` for events the worker itself produced.
 */
export const appendEvents = (events: SessionEvent[], fromTabId?: number): Promise<SessionStats | null> =>
  serialize(async () => {
    if (events.length === 0) return null;
    const session = await loadSession();
    if (!session || session.state !== "recording") return null;
    if (fromTabId !== undefined && session.tab && session.tab.id !== fromTabId) return null;

    const [stats, settings] = await Promise.all([loadStats(), loadSettings()]);
    const room = Math.max(0, settings.maxEvents - stats.events);
    const accepted = events.slice(0, room);
    stats.dropped += events.length - accepted.length;

    for (const e of accepted) accumulateStats(stats, e, JSON.stringify(e).length);
    await putEvents(accepted);
    await chrome.storage.local.set({ [STATS_KEY]: stats });
    return stats;
  });

export const addNote = (text: string): Promise<SessionStats | null> => {
  const trimmed = text.trim();
  if (!trimmed) return Promise.resolve(null);
  const ev: NoteEvent = { type: "note", ts: Date.now(), text: trimmed.slice(0, 2000) };
  return appendEvents([ev]);
};

/** Add screenshot bytes to the counters (screenshots live in IDB, not in the events' JSON). */
export const addShotBytes = (bytes: number): Promise<void> =>
  serialize(async () => {
    const stats = await loadStats();
    stats.shotBytes += bytes;
    await chrome.storage.local.set({ [STATS_KEY]: stats });
  });
