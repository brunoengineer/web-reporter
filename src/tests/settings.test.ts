import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "../shared/settings";

describe("normalizeSettings", () => {
  it("returns defaults for garbage input", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("nope")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values", () => {
    const s = normalizeSettings({ screenshotFormat: "png", screenshotQuality: 60, captureBodies: false, maxBodyKb: 8, maxEvents: 1000 });
    expect(s.screenshotFormat).toBe("png");
    expect(s.screenshotQuality).toBe(60);
    expect(s.captureBodies).toBe(false);
    expect(s.maxBodyKb).toBe(8);
    expect(s.maxEvents).toBe(1000);
  });

  it("clamps numbers into range and coerces strings", () => {
    const s = normalizeSettings({ screenshotQuality: "150", maxBodyKb: -5, maxEvents: 1e9 });
    expect(s.screenshotQuality).toBe(100);
    expect(s.maxBodyKb).toBe(1);
    expect(s.maxEvents).toBe(50000);
  });

  it("ignores wrong types for booleans and enums", () => {
    const s = normalizeSettings({ captureConsole: "yes", screenshotFormat: "gif" });
    expect(s.captureConsole).toBe(true);
    expect(s.screenshotFormat).toBe("jpeg");
  });
});
