export type Severity = "low" | "medium" | "high";

export type SessionState = "idle" | "recording";

export type SessionMeta = {
  id: string;
  state: SessionState;
  startedAt: number;
  title: string;
  severity: Severity;
  notes: string;
};
