import type { SessionMeta, SessionState } from "../shared/schema";
import type { StartPayload } from "../shared/messages";

const STORAGE_KEY = "wr.session";

export const loadSession = async (): Promise<SessionMeta | null> => {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return (data[STORAGE_KEY] as SessionMeta | undefined) ?? null;
};

const save = (meta: SessionMeta) =>
  chrome.storage.local.set({ [STORAGE_KEY]: meta });

const clear = () => chrome.storage.local.remove(STORAGE_KEY);

export const startSession = async (input: StartPayload): Promise<SessionMeta> => {
  const meta: SessionMeta = {
    id: crypto.randomUUID(),
    state: "recording",
    startedAt: Date.now(),
    title: input.title,
    severity: input.severity,
    notes: input.notes,
  };
  await save(meta);
  return meta;
};

export const stopSession = async (): Promise<SessionMeta | null> => {
  const cur = await loadSession();
  if (!cur) return null;
  await clear();
  return cur;
};

export const updateMeta = async (
  patch: Partial<Pick<SessionMeta, "title" | "severity" | "notes">>,
): Promise<SessionMeta | null> => {
  const cur = await loadSession();
  if (!cur) return null;
  const next: SessionMeta = { ...cur, ...patch };
  await save(next);
  return next;
};

export const getState = async (): Promise<SessionState> => {
  const cur = await loadSession();
  return cur?.state ?? "idle";
};
