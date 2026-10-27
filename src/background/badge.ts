import type { SessionState } from "../shared/schema";

const COLORS: Record<SessionState, string> = {
  idle: "#6b7280",
  recording: "#dc2626",
  exporting: "#0d9488",
};

const TEXT: Record<SessionState, string> = {
  idle: "",
  recording: "REC",
  exporting: "…",
};

export const setBadge = async (state: SessionState): Promise<void> => {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: COLORS[state] });
    await chrome.action.setBadgeText({ text: TEXT[state] });
    await chrome.action.setTitle({
      title: state === "recording" ? "Web Reporter — recording" : "Web Reporter",
    });
  } catch {
    // badge is cosmetic; never fail an operation because of it
  }
};

/** Briefly show a confirmation on the badge (e.g. after a shortcut-triggered screenshot). */
export const flashBadge = async (text: string, color: string, restore: SessionState): Promise<void> => {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    setTimeout(() => {
      void setBadge(restore);
    }, 900);
  } catch {
    // cosmetic
  }
};
