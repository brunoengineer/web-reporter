import type { ScreenshotEvent, SessionMeta } from "../shared/schema";
import type { ErrorCode } from "../shared/messages";
import { loadSettings } from "../shared/settingsStore";
import { putShot } from "./db";
import { addShotBytes, appendEvents } from "./session";

export class CaptureError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
  ) {
    super(message);
  }
}

const isCapturableUrl = (url: string | undefined): boolean =>
  !!url && /^(https?|file|ftp):/i.test(url);

/**
 * Capture the recorded tab. The tab must be the active tab of its window — Chrome can only
 * screenshot what is on screen.
 */
export const captureScreenshot = async (
  session: SessionMeta,
  kind: ScreenshotEvent["kind"],
): Promise<ScreenshotEvent> => {
  if (!session.tab) throw new CaptureError("Session is not bound to a tab", "capture-failed");

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(session.tab.id);
  } catch {
    throw new CaptureError("The recorded tab was closed", "tab-closed");
  }
  if (!tab.active) {
    throw new CaptureError("Switch back to the recorded tab to take a screenshot", "tab-not-visible");
  }
  if (!isCapturableUrl(tab.url)) {
    throw new CaptureError("Chrome does not allow screenshots of this page", "capture-failed");
  }

  const settings = await loadSettings();
  const opts: chrome.tabs.CaptureVisibleTabOptions =
    settings.screenshotFormat === "png"
      ? { format: "png" }
      : { format: "jpeg", quality: settings.screenshotQuality };

  let dataUrl: string;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CaptureError(`Screenshot failed: ${msg}`, "capture-failed");
  }
  if (!dataUrl) throw new CaptureError("Screenshot returned no data", "capture-failed");

  const id = crypto.randomUUID();
  await putShot(id, dataUrl);
  await addShotBytes(dataUrl.length);

  const ev: ScreenshotEvent = {
    type: "screenshot",
    ts: Date.now(),
    id,
    kind,
    url: tab.url,
    title: tab.title,
  };
  await appendEvents([ev]);
  return ev;
};
