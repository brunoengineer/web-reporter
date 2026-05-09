import type { SessionMeta, SessionState, Severity } from "./schema";

export type StartPayload = {
  title: string;
  severity: Severity;
  notes: string;
};

export type Msg =
  | { type: "GET_STATE" }
  | { type: "START"; payload: StartPayload }
  | { type: "STOP" }
  | { type: "UPDATE_META"; payload: Partial<Pick<SessionMeta, "title" | "severity" | "notes">> };

export type MsgOk = {
  ok: true;
  state: SessionState;
  meta: SessionMeta | null;
};

export type MsgErr = {
  ok: false;
  error: string;
};

export type MsgResponse = MsgOk | MsgErr;
