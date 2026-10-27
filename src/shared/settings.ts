/**
 * User-configurable capture settings. Pure types + defaults; no chrome.* here so the
 * MAIN-world script can import it too.
 */
export type Settings = {
  /** PNG is lossless but typically 4-6x bigger than JPEG for web pages. */
  screenshotFormat: "png" | "jpeg";
  /** JPEG quality 30-100. Ignored for PNG. */
  screenshotQuality: number;
  captureConsole: boolean;
  captureNetwork: boolean;
  /** Record request/response bodies (text-like content types only). */
  captureBodies: boolean;
  /** Per-body truncation limit. */
  maxBodyKb: number;
  /** Record special keys (Enter, Escape, Tab, arrows, shortcuts). Never printable characters. */
  captureKeys: boolean;
  /** Hard cap on events per session; further events are dropped and counted. */
  maxEvents: number;
};

export const DEFAULT_SETTINGS: Settings = {
  screenshotFormat: "jpeg",
  screenshotQuality: 85,
  captureConsole: true,
  captureNetwork: true,
  captureBodies: true,
  maxBodyKb: 64,
  captureKeys: true,
  maxEvents: 5000,
};

const clamp = (n: number, lo: number, hi: number): number =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : lo;

/** Merge a partial/unknown object onto the defaults, coercing every field to a sane value. */
export const normalizeSettings = (raw: unknown): Settings => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof Settings, unknown>>;
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const num = (v: unknown, d: number, lo: number, hi: number) =>
    v === undefined || v === null || v === "" ? d : clamp(Number(v), lo, hi);
  return {
    screenshotFormat: r.screenshotFormat === "png" ? "png" : "jpeg",
    screenshotQuality: num(r.screenshotQuality, DEFAULT_SETTINGS.screenshotQuality, 30, 100),
    captureConsole: bool(r.captureConsole, DEFAULT_SETTINGS.captureConsole),
    captureNetwork: bool(r.captureNetwork, DEFAULT_SETTINGS.captureNetwork),
    captureBodies: bool(r.captureBodies, DEFAULT_SETTINGS.captureBodies),
    maxBodyKb: num(r.maxBodyKb, DEFAULT_SETTINGS.maxBodyKb, 1, 1024),
    captureKeys: bool(r.captureKeys, DEFAULT_SETTINGS.captureKeys),
    maxEvents: num(r.maxEvents, DEFAULT_SETTINGS.maxEvents, 100, 50000),
  };
};
