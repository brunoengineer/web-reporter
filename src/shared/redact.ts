const SENSITIVE_TYPES = new Set(["password", "tel"]);

const SENSITIVE_NAME_RE = /pass(word)?|secret|token|otp|cvv|cvc|ssn|credit|card/i;

const SENSITIVE_AUTOCOMPLETE_RE =
  /(^|\s)(current-password|new-password|one-time-code|cc-(number|csc|exp))(\s|$)/i;

export const isSensitiveInputType = (type: string): boolean =>
  SENSITIVE_TYPES.has(type.toLowerCase());

export type InputMeta = {
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
};

export const isSensitiveByMeta = (m: InputMeta): boolean => {
  if (m.type && isSensitiveInputType(m.type)) return true;
  const nameOrId = m.name || m.id || "";
  if (nameOrId && SENSITIVE_NAME_RE.test(nameOrId)) return true;
  if (m.autocomplete && SENSITIVE_AUTOCOMPLETE_RE.test(m.autocomplete)) return true;
  return false;
};

export const isSensitiveInput = (el: HTMLInputElement | HTMLTextAreaElement): boolean =>
  isSensitiveByMeta({
    type: el instanceof HTMLInputElement ? el.type : undefined,
    name: el.getAttribute("name") ?? undefined,
    id: el.id || undefined,
    autocomplete: el.getAttribute("autocomplete") ?? undefined,
  });
