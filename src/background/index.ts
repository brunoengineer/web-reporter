import type { Msg, MsgResponse } from "../shared/messages";
import type { ScreenshotEvent, SessionEvent } from "../shared/schema";
import {
  appendEvents,
  getEventsBytes,
  loadEvents,
  loadSession,
  startSession,
  stopSession,
  updateMeta,
} from "./session";
import { saveScreenshot } from "./screenshots";

const AUTO_COOLDOWN_MS = 3000;
let lastAutoAt = 0;

const buildOk = async (
  state: "idle" | "recording",
  meta: Awaited<ReturnType<typeof loadSession>>,
): Promise<MsgResponse> => {
  const [events, eventsBytes] = await Promise.all([loadEvents(), getEventsBytes()]);
  return { ok: true, state, meta, eventsCount: events.length, eventsBytes };
};

const captureAndAppend = async (
  kind: "manual" | "auto",
  triggerTs?: number,
): Promise<ScreenshotEvent | null> => {
  const session = await loadSession();
  if (!session || session.state !== "recording") return null;

  let dataUrl: string;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
  } catch (err) {
    console.warn("[web-reporter] capture failed:", err);
    return null;
  }
  if (!dataUrl) return null;

  const id = crypto.randomUUID();
  await saveScreenshot(id, dataUrl);

  const ev: ScreenshotEvent = {
    type: "screenshot",
    ts: Date.now(),
    id,
    kind,
    triggerTs,
  };
  await appendEvents([ev]);
  return ev;
};

const triggerAutoShotIfNeeded = (events: SessionEvent[]) => {
  const errorEvent = events.find(
    (e) => e.type === "error" || (e.type === "console" && e.level === "error"),
  );
  if (!errorEvent) return;
  const now = Date.now();
  if (now - lastAutoAt < AUTO_COOLDOWN_MS) return;
  lastAutoAt = now;
  void captureAndAppend("auto", errorEvent.ts).catch(() => undefined);
};

const handle = async (msg: Msg): Promise<MsgResponse> => {
  switch (msg.type) {
    case "GET_STATE": {
      const meta = await loadSession();
      return buildOk(meta?.state ?? "idle", meta);
    }
    case "START": {
      const meta = await startSession(msg.payload);
      return buildOk(meta.state, meta);
    }
    case "STOP": {
      const meta = await stopSession();
      return buildOk("idle", meta);
    }
    case "UPDATE_META": {
      const meta = await updateMeta(msg.payload);
      return buildOk(meta?.state ?? "idle", meta);
    }
    case "APPEND_EVENTS": {
      await appendEvents(msg.payload);
      triggerAutoShotIfNeeded(msg.payload);
      const meta = await loadSession();
      return buildOk(meta?.state ?? "idle", meta);
    }
    case "TAKE_SCREENSHOT": {
      await captureAndAppend("manual");
      const meta = await loadSession();
      return buildOk(meta?.state ?? "idle", meta);
    }
  }
};

chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((err: unknown) => {
      const error = err instanceof Error ? err.message : String(err);
      sendResponse({ ok: false, error } satisfies MsgResponse);
    });
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[web-reporter] service worker installed");
});
