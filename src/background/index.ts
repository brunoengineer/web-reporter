import type { Msg, MsgResponse } from "../shared/messages";
import { loadSession, startSession, stopSession, updateMeta } from "./session";

const handle = async (msg: Msg): Promise<MsgResponse> => {
  switch (msg.type) {
    case "GET_STATE": {
      const meta = await loadSession();
      return { ok: true, state: meta?.state ?? "idle", meta };
    }
    case "START": {
      const meta = await startSession(msg.payload);
      return { ok: true, state: meta.state, meta };
    }
    case "STOP": {
      const meta = await stopSession();
      return { ok: true, state: "idle", meta };
    }
    case "UPDATE_META": {
      const meta = await updateMeta(msg.payload);
      return { ok: true, state: meta?.state ?? "idle", meta };
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
