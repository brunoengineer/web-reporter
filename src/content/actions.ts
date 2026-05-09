import type {
  ClickEvent,
  FormInputEvent,
  FormSubmitEvent,
  SessionEvent,
} from "../shared/schema";
import { isSensitiveInput } from "../shared/redact";

const CLICKABLE_SELECTOR =
  "a, button, [role=button], input[type=button], input[type=submit], input[type=reset], [onclick]";

const selectorFor = (el: Element): string => {
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
    const cls = cur.classList[0];
    if (cls) part += `.${CSS.escape(cls)}`;
    parts.unshift(part);
    cur = cur.parentElement;
  }
  return parts.join(" > ");
};

const visibleText = (el: Element): string | undefined => {
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
};

export const attachActionListeners = (emit: (ev: SessionEvent) => void): void => {
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
        text: visibleText(clickable),
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
      const sensitive =
        target instanceof HTMLSelectElement ? false : isSensitiveInput(target);
      const length =
        target instanceof HTMLSelectElement ? 0 : sensitive ? 0 : target.value.length;
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
      const ev: FormSubmitEvent = {
        type: "submit",
        ts: Date.now(),
        selector: selectorFor(target),
      };
      emit(ev);
    },
    true,
  );
};
