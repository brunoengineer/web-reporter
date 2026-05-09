import type { Msg } from "../shared/messages";
import type { PageEvent, SessionEvent } from "../shared/schema";

const TAG = "__wr_event__";

let buffer: SessionEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;

const flush = () => {
  if (buffer.length === 0) return;
  const payload = buffer;
  buffer = [];
  const msg: Msg = { type: "APPEND_EVENTS", payload };
  chrome.runtime.sendMessage(msg).catch(() => {
    // service worker may be unavailable (extension reloaded, no active session, etc.)
  });
};

const schedule = () => {
  if (flushTimer !== undefined) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    flush();
  }, 100);
};

const enqueue = (ev: SessionEvent) => {
  buffer.push(ev);
  schedule();
};

window.addEventListener("message", (e) => {
  if (e.source !== window) return;
  const data = e.data as Record<string, unknown> | null;
  if (!data || data[TAG] !== true) return;
  enqueue(data.event as SessionEvent);
});

const sendPageEvent = () => {
  const ev: PageEvent = {
    type: "page",
    ts: Date.now(),
    url: location.href,
    title: document.title,
    userAgent: navigator.userAgent,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    screen: { w: screen.width, h: screen.height },
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: navigator.platform,
  };
  enqueue(ev);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", sendPageEvent, { once: true });
} else {
  sendPageEvent();
}
