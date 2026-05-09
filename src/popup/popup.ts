import type { Msg, MsgResponse } from "../shared/messages";
import type { SessionMeta, SessionState, Severity } from "../shared/schema";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

const send = (msg: Msg): Promise<MsgResponse> =>
  chrome.runtime.sendMessage(msg) as Promise<MsgResponse>;

const debounce = <T extends (...args: never[]) => unknown>(fn: T, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

const toggleBtn = $<HTMLButtonElement>("toggle");
const screenshotBtn = $<HTMLButtonElement>("screenshot");
const exportBtn = $<HTMLButtonElement>("export");
const statusEl = $<HTMLSpanElement>("status");
const eventsCountEl = $<HTMLSpanElement>("events-count");
const titleEl = $<HTMLInputElement>("title");
const severityEl = $<HTMLSelectElement>("severity");
const notesEl = $<HTMLTextAreaElement>("notes");

let state: SessionState = "idle";

const render = (eventsCount: number) => {
  statusEl.textContent = state;
  statusEl.className = `status ${state}`;
  toggleBtn.textContent = state === "idle" ? "Start recording" : "Stop recording";
  screenshotBtn.disabled = state !== "recording";
  exportBtn.disabled = state !== "recording";
  if (state === "recording") {
    eventsCountEl.hidden = false;
    eventsCountEl.textContent = `${eventsCount} event${eventsCount === 1 ? "" : "s"}`;
  } else {
    eventsCountEl.hidden = true;
  }
};

const populate = (meta: SessionMeta | null) => {
  if (!meta) {
    titleEl.value = "";
    severityEl.value = "medium";
    notesEl.value = "";
    return;
  }
  titleEl.value = meta.title;
  severityEl.value = meta.severity;
  notesEl.value = meta.notes;
};

const apply = (res: MsgResponse) => {
  if (!res.ok) {
    console.error("[web-reporter] popup error:", res.error);
    return;
  }
  state = res.state;
  if (res.state === "idle") populate(null);
  else populate(res.meta);
  render(res.eventsCount);
};

toggleBtn.addEventListener("click", async () => {
  if (state === "idle") {
    apply(
      await send({
        type: "START",
        payload: {
          title: titleEl.value.trim(),
          severity: severityEl.value as Severity,
          notes: notesEl.value,
        },
      }),
    );
  } else {
    apply(await send({ type: "STOP" }));
  }
});

const pushMeta = debounce(async (patch: Partial<SessionMeta>) => {
  if (state !== "recording") return;
  await send({ type: "UPDATE_META", payload: patch });
}, 250);

titleEl.addEventListener("input", () => pushMeta({ title: titleEl.value.trim() }));
severityEl.addEventListener("change", () =>
  pushMeta({ severity: severityEl.value as Severity }),
);
notesEl.addEventListener("input", () => pushMeta({ notes: notesEl.value }));

screenshotBtn.addEventListener("click", () => {
  // wired up in a later commit
});

exportBtn.addEventListener("click", () => {
  // wired up in a later commit
});

(async () => {
  apply(await send({ type: "GET_STATE" }));
})();
