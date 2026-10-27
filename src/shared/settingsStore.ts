import { normalizeSettings, type Settings } from "./settings";

export const SETTINGS_KEY = "wr.settings";

export const loadSettings = async (): Promise<Settings> => {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(data[SETTINGS_KEY]);
};

export const saveSettings = async (patch: Partial<Settings>): Promise<Settings> => {
  const cur = await loadSettings();
  const next = normalizeSettings({ ...cur, ...patch });
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
};
