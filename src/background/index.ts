import type { Msg, MsgResponse } from "../shared/messages";
import {
  appendEvents,
  loadEvents,
  loadSession,
  startSession,
  stopSession,
  updateMeta,
} from "./session";

const buildOk = async (
  state: "idle" | "recording",
  meta: Awaited<ReturnType<typeof loadSession>>,
): Promise<MsgResponse> => {
  const events = await loadEvents();
  return { ok: true, state, meta, eventsCount: events.length };
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
