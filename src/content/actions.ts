import type {
  ClickEvent,
  FormInputEvent,
  FormSubmitEvent,
  KeyEvent,
  SessionEvent,
} from "../shared/schema";
import type { Settings } from "../shared/settings";
import { isSensitiveInput } from "../shared/redact";

const CLICKABLE_SELECTOR =
  "a, button, [role=button], [role=link], [role=menuitem], [role=tab], [role=option], " +
  "input[type=button], input[type=submit], input[type=reset], input[type=checkbox], input[type=radio], " +
  "label, summary, [onclick]";

/** Keys worth recording for a repro. Printable characters are never captured. */
const SPECIAL_KEYS = new Set([
  "Enter",
  "Escape",
  "Tab",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "F5",
]);

export const selectorFor = (el: Element): string => {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && parts.length < 4 && cur.nodeType === 1) {
    const tag = cur.tagName.toLowerCase();
    if (cur.id) {
      parts.unshift(`${tag}#${CSS.escape(cur.id)}`);
      break;
    }
    let part = tag;
    const testId = cur.getAttribute("data-testid") ?? cur.getAttribute("data-test");
    if (testId) {
      parts.unshift(`${tag}[data-testid="${testId.replace(/"/g, '\\"')}"]`);
      break;
    }
    const cls = Array.from(cur.classList).find((c) => !/^[a-z]*[0-9_-]{6,}$/i.test(c) && c.length < 40);
    if (cls) part += `.${CSS.escape(cls)}`;
    const name = cur.getAttribute("name");
    if (name && (tag === "input" || tag === "select" || tag === "textarea")) {
      part += `[name="${name.replace(/"/g, '\\"')}"]`;
    }
    parts.unshift(part);
    cur = cur.parentElement;
  }
  return parts.join(" > ");
};

/** Human-readable label: visible text, else aria-label / title / placeholder / alt. */
export const labelFor = (el: Element): string | undefined => {
  const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  let text = clean(el.textContent);
  if (!text) {
    text =
      clean(el.getAttribute("aria-label")) ||
      clean(el.getAttribute("title")) ||
      clean(el.getAttribute("placeholder")) ||
      clean(el.querySelector("img[alt]")?.getAttribute("alt")) ||
      clean((el as HTMLInputElement).value && (el as HTMLInputElement).type === "submit"
        ? (el as HTMLInputElement).value
        : "");
  }
  if (!text) return undefined;
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
};

const keyLabel = (e: KeyboardEvent): string | null => {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.metaKey) mods.push("Meta");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey && e.key.length > 1) mods.push("Shift");

  if (SPECIAL_KEYS.has(e.key)) return [...mods, e.key].join("+");
  // Shortcuts like Ctrl+S / Ctrl+Z are useful; plain letters are not recorded.
  if ((e.ctrlKey || e.metaKey) && e.key.length === 1 && /[a-z0-9]/i.test(e.key)) {
    return [...mods, e.key.toUpperCase()].join("+");
  }
  return null;
};

export const attachActionListeners = (
  emit: (ev: SessionEvent) => void,
  settings: () => Settings,
): void => {
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target as Element | null;
      if (!target || target.nodeType !== 1) return;
      const clickable = target.closest(CLICKABLE_SELECTOR) ?? target;
      const ev: ClickEvent = {
        type: "click",
        ts: Date.now(),
        selector: selectorFor(clickable),
        tag: clickable.tagName,
        text: labelFor(clickable),
        href: clickable instanceof HTMLAnchorElement ? clickable.href : undefined,
      };
      emit(ev);
    },
    true,
  );

  document.addEventListener(
    "change",
    (e) => {
      const target = e.target;
      if (
        !(target instanceof HTMLInputElement) &&
        !(target instanceof HTMLTextAreaElement) &&
        !(target instanceof HTMLSelectElement)
      ) {
        return;
      }
      const inputType =
        target instanceof HTMLInputElement ? target.type : target.tagName.toLowerCase();
      const sensitive = target instanceof HTMLSelectElement ? false : isSensitiveInput(target);
      const length =
        target instanceof HTMLSelectElement ? target.value.length : sensitive ? 0 : target.value.length;
      const ev: FormInputEvent = {
        type: "input",
        ts: Date.now(),
        selector: selectorFor(target),
        inputType,
        length,
        redacted: sensitive,
      };
      emit(ev);
    },
    true,
  );

  document.addEventListener(
    "submit",
    (e) => {
      const target = e.target;
      if (!(target instanceof HTMLFormElement)) return;
      const ev: FormSubmitEvent = { type: "submit", ts: Date.now(), selector: selectorFor(target) };
      emit(ev);
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (!settings().captureKeys) return;
      if (e.isComposing) return;
      const label = keyLabel(e);
      if (!label) return;
      const target = e.target as Element | null;
      const ev: KeyEvent = {
        type: "key",
        ts: Date.now(),
        key: label,
        selector: target && target.nodeType === 1 ? selectorFor(target) : "document",
      };
      emit(ev);
    },
    true,
  );
};
