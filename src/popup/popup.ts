type SessionState = "idle" | "recording";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

const toggleBtn = $<HTMLButtonElement>("toggle");
const screenshotBtn = $<HTMLButtonElement>("screenshot");
const exportBtn = $<HTMLButtonElement>("export");
const statusEl = $<HTMLSpanElement>("status");
const titleEl = $<HTMLInputElement>("title");
const severityEl = $<HTMLSelectElement>("severity");
const notesEl = $<HTMLTextAreaElement>("notes");

let state: SessionState = "idle";

const render = () => {
  statusEl.textContent = state;
  statusEl.className = `status ${state}`;
  toggleBtn.textContent = state === "idle" ? "Start recording" : "Stop recording";
  screenshotBtn.disabled = state !== "recording";
  exportBtn.disabled = state !== "recording";
};

toggleBtn.addEventListener("click", () => {
  state = state === "idle" ? "recording" : "idle";
  render();
});

screenshotBtn.addEventListener("click", () => {
  // wired up to background in a later commit
});

exportBtn.addEventListener("click", () => {
  // wired up to background in a later commit
});

titleEl.addEventListener("input", () => {});
severityEl.addEventListener("change", () => {});
notesEl.addEventListener("input", () => {});

render();
