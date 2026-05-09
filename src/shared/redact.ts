const SENSITIVE_TYPES = new Set([
  "password",
  "tel",
]);

const SENSITIVE_NAME_RE = /pass(word)?|secret|token|otp|cvv|cvc|ssn|credit|card/i;

const SENSITIVE_AUTOCOMPLETE_RE =
  /(^|\s)(current-password|new-password|one-time-code|cc-(number|csc|exp))(\s|$)/i;

export const isSensitiveInputType = (type: string): boolean =>
  SENSITIVE_TYPES.has(type.toLowerCase());

export const isSensitiveInput = (el: HTMLInputElement | HTMLTextAreaElement): boolean => {
  if (el instanceof HTMLInputElement && isSensitiveInputType(el.type)) return true;
  const name = el.getAttribute("name") || el.id || "";
  if (name && SENSITIVE_NAME_RE.test(name)) return true;
  const autocomplete = el.getAttribute("autocomplete") || "";
  if (autocomplete && SENSITIVE_AUTOCOMPLETE_RE.test(autocomplete)) return true;
  return false;
};
