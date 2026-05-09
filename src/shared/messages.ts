import type { SessionEvent, SessionMeta, SessionState, Severity } from "./schema";

export type StartPayload = {
  title: string;
  severity: Severity;
  notes: string;
};

export type Msg =
  | { type: "GET_STATE" }
  | { type: "START"; payload: StartPayload }
  | { type: "STOP" }
  | { type: "UPDATE_META"; payload: Partial<Pick<SessionMeta, "title" | "severity" | "notes">> }
  | { type: "APPEND_EVENTS"; payload: SessionEvent[] };

export type MsgOk = {
  ok: true;
  state: SessionState;
  meta: SessionMeta | null;
  eventsCount: number;
};

export type MsgErr = {
  ok: false;
  error: string;
};

export type MsgResponse = MsgOk | MsgErr;
