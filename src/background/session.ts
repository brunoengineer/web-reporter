import type { SessionEvent, SessionMeta, SessionState } from "../shared/schema";
import type { StartPayload } from "../shared/messages";

const SESSION_KEY = "wr.session";
const EVENTS_KEY = "wr.events";

export const loadSession = async (): Promise<SessionMeta | null> => {
  const data = await chrome.storage.local.get(SESSION_KEY);
  return (data[SESSION_KEY] as SessionMeta | undefined) ?? null;
};

export const loadEvents = async (): Promise<SessionEvent[]> => {
  const data = await chrome.storage.local.get(EVENTS_KEY);
  return (data[EVENTS_KEY] as SessionEvent[] | undefined) ?? [];
};

const saveSession = (meta: SessionMeta) =>
  chrome.storage.local.set({ [SESSION_KEY]: meta });

export const startSession = async (input: StartPayload): Promise<SessionMeta> => {
  const meta: SessionMeta = {
    id: crypto.randomUUID(),
    state: "recording",
    startedAt: Date.now(),
    title: input.title,
    severity: input.severity,
    notes: input.notes,
  };
  await chrome.storage.local.set({ [SESSION_KEY]: meta, [EVENTS_KEY]: [] });
  return meta;
};

export const stopSession = async (): Promise<SessionMeta | null> => {
  const cur = await loadSession();
  if (!cur) return null;
  await chrome.storage.local.remove([SESSION_KEY, EVENTS_KEY]);
  return cur;
};

export const updateMeta = async (
  patch: Partial<Pick<SessionMeta, "title" | "severity" | "notes">>,
): Promise<SessionMeta | null> => {
  const cur = await loadSession();
  if (!cur) return null;
  const next: SessionMeta = { ...cur, ...patch };
  await saveSession(next);
  return next;
};

export const appendEvents = async (events: SessionEvent[]): Promise<number> => {
  if (events.length === 0) return 0;
  const session = await loadSession();
  if (!session || session.state !== "recording") return 0;
  const cur = await loadEvents();
  const next = cur.concat(events);
  await chrome.storage.local.set({ [EVENTS_KEY]: next });
  return next.length;
};

export const getState = async (): Promise<SessionState> => {
  const cur = await loadSession();
  return cur?.state ?? "idle";
};
