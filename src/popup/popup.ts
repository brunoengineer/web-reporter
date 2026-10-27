import type { Msg, MsgResponse } from "../shared/messages";
import {
  SEVERITIES,
  emptyStats,
  type SessionMeta,
  type SessionState,
  type SessionStats,
  type Severity,
} from "../shared/schema";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

const send = async (msg: Msg): Promise<MsgResponse> => {
  try {
    return (await chrome.runtime.sendMessage(msg)) as MsgResponse;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

const debounce = <T extends (...args: never[]) => unknown>(fn: T, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

// ----- elements -----

const statusEl = $<HTMLSpanElement>("status");
const toastEl = $<HTMLDivElement>("toast");
const tabFavicon = $<HTMLImageElement>("tab-favicon");
const tabFaviconFallback = $<HTMLSpanElement>("tab-favicon-fallback");
const tabLabel = $<HTMLDivElement>("tab-label");
const tabTitle = $<HTMLDivElement>("tab-title");
const tabUrl = $<HTMLDivElement>("tab-url");
const warningEl = $<HTMLDivElement>("warning");
const warningText = $<HTMLSpanElement>("warning-text");
const warningAction = $<HTMLButtonElement>("warning-action");
const recPanel = $<HTMLElement>("rec-panel");
const elapsedEl = $<HTMLSpanElement>("elapsed");
const sizeEl = $<HTMLSpanElement>("size");
const droppedEl = $<HTMLDivElement>("dropped");
const titleEl = $<HTMLInputElement>("title");
const severityEl = $<HTMLDivElement>("severity");
const notesEl = $<HTMLTextAreaElement>("notes");
const notePanel = $<HTMLElement>("note-panel");
const noteText = $<HTMLInputElement>("note-text");
const noteAdd = $<HTMLButtonElement>("note-add");
const actionsIdle = $<HTMLDivElement>("actions-idle");
const actionsRec = $<HTMLDivElement>("actions-rec");
const startBtn = $<HTMLButtonElement>("start");
const screenshotBtn = $<HTMLButtonElement>("screenshot");
const exportBtn = $<HTMLButtonElement>("export");
const discardBtn = $<HTMLButtonElement>("discard");
const openOptions = $<HTMLButtonElement>("open-options");
const versionEl = $<HTMLSpanElement>("version");

// ----- state -----

let state: SessionState = "idle";
let meta: SessionMeta | null = null;
let stats: SessionStats = emptyStats();
let severity: Severity = "medium";
let activeTab: chrome.tabs.Tab | null = null;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let tickTimer: ReturnType<typeof setInterval> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let discardArmed: ReturnType<typeof setTimeout> | undefined;

const SIZE_WARN_BYTES = 20 * 1024 * 1024;

// ----- helpers -----

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

const hostOf = (url: string | undefined): string => {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return url;
  }
};

const isRecordableUrl = (url: string | undefined): boolean => !!url && /^(https?|file):/i.test(url);

const toast = (text: string, kind: "info" | "error" | "success" = "info", ms = 3500) => {
  toastEl.textContent = text;
  toastEl.className = `toast ${kind}`;
  toastEl.hidden = false;
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, ms);
};

const showWarning = (text: string, action?: { label: string; onClick: () => void }) => {
  warningText.textContent = text;
  warningEl.hidden = false;
  if (action) {
    warningAction.textContent = action.label;
    warningAction.hidden = false;
    warningAction.onclick = action.onClick;
  } else {
    warningAction.hidden = true;
    warningAction.onclick = null;
  }
};

const hideWarning = () => {
  warningEl.hidden = true;
};

// ----- rendering -----

const renderTabCard = () => {
  const recordedTab = meta?.tab ?? null;
  const tab = state === "idle" ? activeTab : null;
  const url = recordedTab?.url ?? tab?.url;
  const title = recordedTab?.title ?? tab?.title;
  const favicon = state === "idle" ? tab?.favIconUrl : activeTab?.id === recordedTab?.id ? activeTab?.favIconUrl : undefined;

  tabLabel.textContent = state === "idle" ? "Will record this tab" : "Recording tab";
  tabTitle.textContent = title || "(untitled)";
  tabUrl.textContent = hostOf(url) || "—";
  tabUrl.title = url ?? "";

  if (favicon && /^https?:/.test(favicon)) {
    tabFavicon.src = favicon;
    tabFavicon.hidden = false;
    tabFaviconFallback.hidden = true;
  } else {
    tabFavicon.hidden = true;
    tabFaviconFallback.hidden = false;
  }
};

const renderSeverity = () => {
  severityEl.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
    const on = b.dataset.value === severity;
    b.classList.toggle("active", on);
    b.setAttribute("aria-checked", String(on));
  });
};

const renderStats = () => {
  for (const chip of document.querySelectorAll<HTMLSpanElement>(".chip[data-k]")) {
    const k = chip.dataset.k as keyof SessionStats;
    const n = stats[k] ?? 0;
    chip.querySelector("b")!.textContent = String(n);
    chip.classList.toggle("nonzero", n > 0);
  }
  const estimate = stats.bytes + stats.shotBytes + 120 * 1024;
  sizeEl.textContent = `~${formatBytes(estimate)}`;
  sizeEl.classList.toggle("big", estimate > SIZE_WARN_BYTES);
  sizeEl.title = estimate > SIZE_WARN_BYTES ? "Report is getting large — consider exporting now" : "Estimated report size";
  if (stats.dropped > 0) {
    droppedEl.hidden = false;
    droppedEl.textContent = `Event limit reached: ${stats.dropped} newer events were dropped. Export now or raise the limit in Settings.`;
  } else {
    droppedEl.hidden = true;
  }
};

const renderElapsed = () => {
  if (!meta) return;
  elapsedEl.textContent = formatElapsed(Date.now() - meta.startedAt);
};

const render = () => {
  statusEl.textContent = state === "idle" ? "Idle" : state === "recording" ? "Rec" : "Exporting";
  statusEl.className = `status ${state}`;

  const recording = state !== "idle";
  recPanel.hidden = !recording;
  notePanel.hidden = !recording;
  actionsIdle.hidden = recording;
  actionsRec.hidden = !recording;

  const busy = state === "exporting";
  screenshotBtn.disabled = busy;
  exportBtn.disabled = busy;
  discardBtn.disabled = busy;
  noteAdd.disabled = busy;
  exportBtn.lastChild!.textContent = busy ? " Exporting…" : " Export report";

  renderTabCard();
  renderSeverity();
  renderStats();
  renderElapsed();
  renderWarnings();
};

const renderWarnings = () => {
  if (state === "idle") {
    if (!activeTab) {
      showWarning("No active tab found.");
    } else if (!isRecordableUrl(activeTab.url)) {
      showWarning("This page can't be recorded. Open a website in this tab first.");
    } else {
      hideWarning();
    }
    startBtn.disabled = !activeTab || !isRecordableUrl(activeTab.url);
    return;
  }

  const t = meta?.tab;
  if (!t) return hideWarning();
  if (t.closed) {
    showWarning("The recorded tab was closed. You can still export what was captured.");
  } else if (activeTab && activeTab.id !== t.id) {
    showWarning("You're on a different tab. Only the recorded tab is captured.", {
      label: "Go to tab",
      onClick: () => {
        void chrome.tabs.update(t.id, { active: true });
        void chrome.windows.update(t.windowId, { focused: true });
        window.close();
      },
    });
  } else {
    hideWarning();
  }
};

const populateForm = (m: SessionMeta | null) => {
  if (!m) return;
  titleEl.value = m.title;
  severity = m.severity;
  notesEl.value = m.notes;
};

const apply = (res: MsgResponse): res is Extract<MsgResponse, { ok: true }> => {
  if (!res.ok) {
    toast(res.error, "error");
    return false;
  }
  const prev = state;
  state = res.state;
  meta = res.meta;
  stats = res.stats;
  if (prev === "idle" && state !== "idle") populateForm(meta);
  if (state === "idle" && prev !== "idle") {
    // session ended: keep the form as-is so a retry is one click away
  }
  render();
  syncTimers();
  return true;
};

// ----- timers -----

const refresh = async () => {
  const res = await send({ type: "GET_STATE" });
  if (res.ok) {
    state = res.state;
    meta = res.meta;
    stats = res.stats;
    render();
    syncTimers();
  }
};

const syncTimers = () => {
  const recording = state !== "idle";
  if (recording && pollTimer === undefined) {
    pollTimer = setInterval(() => void refresh(), 1000);
    tickTimer = setInterval(renderElapsed, 1000);
  } else if (!recording && pollTimer !== undefined) {
    clearInterval(pollTimer);
    clearInterval(tickTimer);
    pollTimer = tickTimer = undefined;
  }
};

// ----- actions -----

startBtn.addEventListener("click", async () => {
  if (!activeTab || activeTab.id === undefined || activeTab.windowId === undefined) return;
  if (!isRecordableUrl(activeTab.url)) return;
  startBtn.disabled = true;
  const res = await send({
    type: "START",
    payload: {
      title: titleEl.value.trim(),
      severity,
      notes: notesEl.value,
      tab: { id: activeTab.id, windowId: activeTab.windowId, url: activeTab.url ?? "", title: activeTab.title ?? "" },
    },
  });
  if (!apply(res)) {
    startBtn.disabled = false;
    return;
  }
  if (res.contentScriptReady === false) {
    const tabId = activeTab.id;
    showWarning("Reload the page so Web Reporter can hook into it.", {
      label: "Reload page",
      onClick: () => {
        void chrome.tabs.reload(tabId);
        hideWarning();
        toast("Page reloaded — capturing.", "success");
      },
    });
  }
});

screenshotBtn.addEventListener("click", async () => {
  screenshotBtn.disabled = true;
  const res = await send({ type: "TAKE_SCREENSHOT" });
  if (apply(res)) toast("Screenshot saved.", "success", 1500);
  screenshotBtn.disabled = state === "exporting";
});

exportBtn.addEventListener("click", async () => {
  if (!titleEl.value.trim()) {
    titleEl.focus();
    toast("Give the report a title first.", "error");
    return;
  }
  exportBtn.disabled = true;
  state = "exporting";
  render();
  const res = await send({ type: "EXPORT" });
  if (!res.ok) {
    // keep whatever state the worker reports now
    await refresh();
    if (res.code === "export-cancelled") toast("Export cancelled — session kept.", "info");
    else toast(res.error, "error", 6000);
    return;
  }
  apply(res);
  if (res.exported) toast(`Saved ${res.exported.filename} (${formatBytes(res.exported.bytes)})`, "success", 6000);
});

discardBtn.addEventListener("click", async () => {
  if (discardArmed === undefined) {
    discardBtn.textContent = "Click again to discard everything";
    discardBtn.classList.add("confirm");
    discardArmed = setTimeout(() => {
      discardArmed = undefined;
      discardBtn.textContent = "Discard session";
      discardBtn.classList.remove("confirm");
    }, 4000);
    return;
  }
  clearTimeout(discardArmed);
  discardArmed = undefined;
  discardBtn.textContent = "Discard session";
  discardBtn.classList.remove("confirm");
  if (apply(await send({ type: "STOP" }))) toast("Session discarded.", "info");
});

const addNote = async () => {
  const text = noteText.value.trim();
  if (!text) return;
  noteAdd.disabled = true;
  const res = await send({ type: "ADD_NOTE", payload: { text } });
  if (apply(res)) {
    noteText.value = "";
    toast("Note added.", "success", 1200);
  }
  noteAdd.disabled = state === "exporting";
  noteText.focus();
};
noteAdd.addEventListener("click", () => void addNote());
noteText.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    void addNote();
  }
});

const pushMeta = debounce(async (patch: Partial<Pick<SessionMeta, "title" | "severity" | "notes">>) => {
  if (state === "idle") return;
  await send({ type: "UPDATE_META", payload: patch });
}, 250);

titleEl.addEventListener("input", () => pushMeta({ title: titleEl.value.trim() }));
notesEl.addEventListener("input", () => pushMeta({ notes: notesEl.value }));
severityEl.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-value]");
  if (!btn) return;
  const v = btn.dataset.value as Severity;
  if (!SEVERITIES.includes(v)) return;
  severity = v;
  renderSeverity();
  pushMeta({ severity });
});

openOptions.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

// ----- bootstrap -----

(async () => {
  versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab ?? null;
  } catch {
    activeTab = null;
  }
  if (activeTab?.title && !titleEl.value) titleEl.placeholder = activeTab.title.slice(0, 80);
  const res = await send({ type: "GET_STATE" });
  if (res.ok) {
    state = res.state;
    meta = res.meta;
    stats = res.stats;
    populateForm(meta);
  } else {
    toast(res.error, "error");
  }
  render();
  syncTimers();
  if (state === "idle") titleEl.focus();
})();
