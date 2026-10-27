import type {
  SessionEvent,
  SessionMeta,
  SessionState,
  SessionStats,
  SessionTab,
  Severity,
} from "./schema";
import type { Settings } from "./settings";

export type StartPayload = {
  title: string;
  severity: Severity;
  notes: string;
  tab: SessionTab;
};

/** What a content script needs to know to decide whether (and how) to capture. */
export type CaptureConfig = {
  recording: boolean;
  settings: Settings;
};

export type Msg =
  | { type: "GET_STATE" }
  | { type: "START"; payload: StartPayload }
  | { type: "STOP" }
  | { type: "UPDATE_META"; payload: Partial<Pick<SessionMeta, "title" | "severity" | "notes">> }
  | { type: "APPEND_EVENTS"; payload: SessionEvent[] }
  | { type: "TAKE_SCREENSHOT" }
  | { type: "ADD_NOTE"; payload: { text: string } }
  | { type: "EXPORT" }
  /** content script -> service worker: "am I in the recorded tab, and with which settings?" */
  | { type: "CS_HELLO" }
  /** service worker -> content script: push a config change. */
  | { type: "CAPTURE_CONFIG"; payload: CaptureConfig };

export type MsgOk = {
  ok: true;
  state: SessionState;
  meta: SessionMeta | null;
  stats: SessionStats;
  settings: Settings;
  /** START only: whether the content script in the recorded tab acknowledged. */
  contentScriptReady?: boolean;
  /** EXPORT only. */
  exported?: { filename: string; bytes: number };
};

export type HelloOk = {
  ok: true;
  hello: CaptureConfig;
};

export type ErrorCode =
  | "no-session"
  | "tab-not-visible"
  | "tab-closed"
  | "capture-failed"
  | "export-cancelled"
  | "export-failed";

export type MsgErr = {
  ok: false;
  error: string;
  code?: ErrorCode;
};

export type MsgResponse = MsgOk | MsgErr;
export type HelloResponse = HelloOk | MsgErr;
