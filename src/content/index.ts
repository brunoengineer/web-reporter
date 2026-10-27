/**
 * Isolated-world content script: the bridge between the page (MAIN world hooks) and the
 * service worker. It captures nothing unless the worker says this tab is being recorded.
 */
import type { CaptureConfig, HelloResponse, Msg } from "../shared/messages";
import type { PageEvent, SessionEvent } from "../shared/schema";
import { DEFAULT_SETTINGS } from "../shared/settings";
import { attachActionListeners } from "./actions";
import { CONTROL_TAG, EVENT_TAG } from "./protocol";

const SESSION_KEY = "wr.session";

let config: CaptureConfig = { recording: false, settings: DEFAULT_SETTINGS };
let buffer: SessionEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;

// ----- outbound: events -> service worker -----

const flush = () => {
  if (flushTimer !== undefined) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  if (buffer.length === 0) return;
  const payload = buffer;
  buffer = [];
  const msg: Msg = { type: "APPEND_EVENTS", payload };
  try {
    chrome.runtime.sendMessage(msg).catch(() => {
      /* worker unavailable (extension reloaded, no session) */
    });
  } catch {
    /* extension context invalidated */
  }
};

const enqueue = (ev: SessionEvent) => {
  if (!config.recording) return;
  buffer.push(ev);
  if (flushTimer === undefined) flushTimer = setTimeout(flush, 100);
};

// Don't lose the tail of the session on navigation / tab close.
window.addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flush();
});

// ----- page metadata -----

const pageEvent = (): PageEvent => ({
  type: "page",
  ts: Date.now(),
  url: location.href,
  title: document.title,
  referrer: document.referrer || undefined,
  userAgent: navigator.userAgent,
  viewport: { w: window.innerWidth, h: window.innerHeight },
  screen: { w: screen.width, h: screen.height },
  dpr: window.devicePixelRatio,
  language: navigator.language,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  platform: navigator.platform,
  online: navigator.onLine,
});

const sendPageEvent = () => {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => enqueue(pageEvent()), { once: true });
  } else {
    enqueue(pageEvent());
  }
};

// ----- config: service worker -> here -> page world -----

const postControl = () => {
  window.postMessage({ [CONTROL_TAG]: true, config }, "*");
};

const applyConfig = (next: CaptureConfig) => {
  const wasRecording = config.recording;
  config = next;
  postControl();
  if (next.recording && !wasRecording) sendPageEvent();
  if (!next.recording) {
    buffer = [];
  }
};

const hello = async () => {
  try {
    const res = (await chrome.runtime.sendMessage({ type: "CS_HELLO" } satisfies Msg)) as
      | HelloResponse
      | undefined;
    if (res && res.ok) applyConfig(res.hello);
  } catch {
    /* worker not reachable; stay idle */
  }
};

chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
  if (msg.type === "CAPTURE_CONFIG") {
    applyConfig(msg.payload);
    sendResponse({ ok: true });
  }
  return false;
});

// Fallback for when the worker couldn't reach us directly (e.g. it restarted).
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SESSION_KEY]) void hello();
  });
} catch {
  /* storage not accessible */
}

// ----- inbound: page world -> here -----

window.addEventListener("message", (e) => {
  if (e.source !== window) return;
  const data = e.data as Record<string, unknown> | null;
  if (!data || data[EVENT_TAG] !== true) return;
  enqueue(data.event as SessionEvent);
});

attachActionListeners(enqueue, () => config.settings);

// Re-announce config once the page world script is surely listening (it runs at document_start
// too, but ordering between the two scripts isn't guaranteed).
void hello().then(() => setTimeout(postControl, 0));
