import { DEFAULT_SETTINGS, type Settings } from "../shared/settings";
import { loadSettings, saveSettings } from "../shared/settingsStore";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

const format = $<HTMLSelectElement>("screenshotFormat");
const quality = $<HTMLInputElement>("screenshotQuality");
const qualityOut = $<HTMLOutputElement>("screenshotQuality-out");
const qualityRow = $<HTMLDivElement>("quality-row");
const captureConsole = $<HTMLInputElement>("captureConsole");
const captureNetwork = $<HTMLInputElement>("captureNetwork");
const captureBodies = $<HTMLInputElement>("captureBodies");
const maxBodyKb = $<HTMLInputElement>("maxBodyKb");
const captureKeys = $<HTMLInputElement>("captureKeys");
const maxEvents = $<HTMLInputElement>("maxEvents");
const savedEl = $<HTMLSpanElement>("saved");
const resetBtn = $<HTMLButtonElement>("reset");
const shortcuts = $<HTMLAnchorElement>("shortcuts");

let savedTimer: ReturnType<typeof setTimeout> | undefined;

const fill = (s: Settings) => {
  format.value = s.screenshotFormat;
  quality.value = String(s.screenshotQuality);
  qualityOut.value = String(s.screenshotQuality);
  captureConsole.checked = s.captureConsole;
  captureNetwork.checked = s.captureNetwork;
  captureBodies.checked = s.captureBodies;
  maxBodyKb.value = String(s.maxBodyKb);
  captureKeys.checked = s.captureKeys;
  maxEvents.value = String(s.maxEvents);
  syncDependent();
};

const syncDependent = () => {
  qualityRow.classList.toggle("disabled", format.value !== "jpeg");
  const net = captureNetwork.checked;
  captureBodies.closest(".row")!.classList.toggle("disabled", !net);
  maxBodyKb.closest(".row")!.classList.toggle("disabled", !net || !captureBodies.checked);
};

const read = (): Settings => ({
  screenshotFormat: format.value === "png" ? "png" : "jpeg",
  screenshotQuality: Number(quality.value),
  captureConsole: captureConsole.checked,
  captureNetwork: captureNetwork.checked,
  captureBodies: captureBodies.checked,
  maxBodyKb: Number(maxBodyKb.value),
  captureKeys: captureKeys.checked,
  maxEvents: Number(maxEvents.value),
});

const flashSaved = () => {
  savedEl.hidden = false;
  if (savedTimer !== undefined) clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    savedEl.hidden = true;
  }, 1500);
};

const save = async () => {
  const next = await saveSettings(read());
  fill(next); // reflect clamping
  flashSaved();
};

for (const el of [format, captureConsole, captureNetwork, captureBodies, captureKeys]) {
  el.addEventListener("change", () => void save());
}
for (const el of [maxBodyKb, maxEvents]) {
  el.addEventListener("change", () => void save());
}
quality.addEventListener("input", () => {
  qualityOut.value = quality.value;
});
quality.addEventListener("change", () => void save());

resetBtn.addEventListener("click", async () => {
  const next = await saveSettings({ ...DEFAULT_SETTINGS });
  fill(next);
  flashSaved();
});

shortcuts.addEventListener("click", (e) => {
  e.preventDefault();
  void chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

void loadSettings().then(fill);
