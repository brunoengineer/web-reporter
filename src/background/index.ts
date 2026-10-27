import type { CaptureConfig, HelloResponse, Msg, MsgErr, MsgOk, MsgResponse } from "../shared/messages";
import type { SessionMeta } from "../shared/schema";
import { loadSettings } from "../shared/settingsStore";
import { SETTINGS_KEY } from "../shared/settingsStore";
import { flashBadge, setBadge } from "./badge";
import { deleteLegacyDb } from "./db";
import { ExportError, exportSession } from "./exporter";
import { CaptureError, captureScreenshot } from "./screenshots";
import {
  addNote,
  appendEvents,
  loadSession,
  loadStats,
  markTabClosed,
  setSessionState,
  startSession,
  stopSession,
  updateMeta,
} from "./session";

// ----- helpers -----

const ok = async (meta: SessionMeta | null, extra: Partial<MsgOk> = {}): Promise<MsgOk> => {
  const [stats, settings] = await Promise.all([loadStats(), loadSettings()]);
  return { ok: true, state: meta?.state ?? "idle", meta, stats, settings, ...extra };
};

const err = (error: string, code?: MsgErr["code"]): MsgErr => ({ ok: false, error, code });

const captureConfigFor = async (tabId: number | undefined): Promise<CaptureConfig> => {
  const [meta, settings] = await Promise.all([loadSession(), loadSettings()]);
  const recording =
    !!meta && meta.state === "recording" && !!meta.tab && tabId !== undefined && meta.tab.id === tabId;
  return { recording, settings };
};

/** Tell the content script in `tabId` whether it should capture. Resolves false if it isn't there. */
const pushCaptureConfig = async (tabId: number, recording: boolean): Promise<boolean> => {
  const settings = await loadSettings();
  const msg: Msg = { type: "CAPTURE_CONFIG", payload: { recording, settings } };
  try {
    await chrome.tabs.sendMessage(tabId, msg);
    return true;
  } catch {
    return false; // no content script in that tab (page loaded before install, chrome:// url, ...)
  }
};

// ----- message handling -----

const handle = async (msg: Msg, sender: chrome.runtime.MessageSender): Promise<MsgResponse | HelloResponse> => {
  switch (msg.type) {
    case "GET_STATE":
      return ok(await loadSession());

    case "START": {
      const existing = await loadSession();
      if (existing && existing.state !== "idle") return err("A session is already running", "no-session");
      const meta = await startSession(msg.payload);
      const contentScriptReady = await pushCaptureConfig(meta.tab!.id, true);
      return ok(meta, { contentScriptReady });
    }

    case "STOP": {
      const cur = await loadSession();
      await stopSession();
      if (cur?.tab) void pushCaptureConfig(cur.tab.id, false);
      return ok(null);
    }

    case "UPDATE_META":
      return ok(await updateMeta(msg.payload));

    case "APPEND_EVENTS": {
      await appendEvents(msg.payload, sender.tab?.id);
      return ok(await loadSession());
    }

    case "TAKE_SCREENSHOT": {
      const session = await loadSession();
      if (!session || session.state !== "recording") return err("No active session", "no-session");
      try {
        await captureScreenshot(session, "manual");
      } catch (e) {
        if (e instanceof CaptureError) return err(e.message, e.code);
        throw e;
      }
      return ok(session);
    }

    case "ADD_NOTE": {
      const session = await loadSession();
      if (!session || session.state !== "recording") return err("No active session", "no-session");
      await addNote(msg.payload.text);
      return ok(session);
    }

    case "EXPORT": {
      const session = await loadSession();
      if (!session || session.state === "idle") return err("No active session", "no-session");
      if (session.state === "exporting") return err("Export already in progress", "export-failed");
      await setSessionState("exporting");
      await setBadge("exporting");
      try {
        const exported = await exportSession();
        await stopSession();
        if (session.tab) void pushCaptureConfig(session.tab.id, false);
        return ok(null, { exported });
      } catch (e) {
        // Keep the session so nothing is lost; the user can retry.
        await setSessionState("recording");
        await setBadge("recording");
        if (e instanceof ExportError) return err(e.message, e.cancelled ? "export-cancelled" : "export-failed");
        throw e;
      }
    }

    case "CS_HELLO":
      return { ok: true, hello: await captureConfigFor(sender.tab?.id) };

    case "CAPTURE_CONFIG":
      // Only ever sent by this worker to content scripts.
      return err("Unexpected message");
  }
};

chrome.runtime.onMessage.addListener((msg: Msg, sender, sendResponse) => {
  handle(msg, sender)
    .then(sendResponse)
    .catch((e: unknown) => {
      const error = e instanceof Error ? e.message : String(e);
      console.error("[web-reporter]", msg.type, "failed:", e);
      sendResponse({ ok: false, error } satisfies MsgErr);
    });
  return true;
});

// ----- keyboard shortcuts (see manifest `commands`) -----

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "take-screenshot") return;
  const session = await loadSession();
  if (!session || session.state !== "recording") return;
  try {
    await captureScreenshot(session, "manual");
    await flashBadge("✓", "#16a34a", "recording");
  } catch (e) {
    console.warn("[web-reporter] shortcut screenshot failed:", e);
    await flashBadge("✕", "#dc2626", "recording");
  }
});

// ----- tab lifecycle -----

chrome.tabs.onRemoved.addListener((tabId) => {
  void markTabClosed(tabId);
});

// Keep the content script's settings fresh without a reload.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[SETTINGS_KEY]) return;
  void (async () => {
    const meta = await loadSession();
    if (meta?.tab && meta.state === "recording") await pushCaptureConfig(meta.tab.id, true);
  })();
});

// ----- lifecycle -----

const syncBadge = async () => {
  const meta = await loadSession();
  await setBadge(meta?.state ?? "idle");
};

chrome.runtime.onInstalled.addListener(() => {
  deleteLegacyDb();
  void syncBadge();
});

chrome.runtime.onStartup.addListener(() => {
  void syncBadge();
});

// The worker may be restarted at any time; make sure the badge reflects reality.
void syncBadge();
