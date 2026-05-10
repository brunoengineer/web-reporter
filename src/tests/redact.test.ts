import { describe, expect, it } from "vitest";
import {
  isSensitiveByMeta,
  isSensitiveHeader,
  isSensitiveInputType,
  redactHeaders,
} from "../shared/redact";

describe("isSensitiveInputType", () => {
  it("flags password and tel", () => {
    expect(isSensitiveInputType("password")).toBe(true);
    expect(isSensitiveInputType("PASSWORD")).toBe(true);
    expect(isSensitiveInputType("tel")).toBe(true);
  });

  it("does not flag normal types", () => {
    expect(isSensitiveInputType("text")).toBe(false);
    expect(isSensitiveInputType("email")).toBe(false);
    expect(isSensitiveInputType("number")).toBe(false);
    expect(isSensitiveInputType("url")).toBe(false);
    expect(isSensitiveInputType("checkbox")).toBe(false);
  });
});

describe("isSensitiveByMeta", () => {
  it("flags by sensitive type", () => {
    expect(isSensitiveByMeta({ type: "password" })).toBe(true);
    expect(isSensitiveByMeta({ type: "tel" })).toBe(true);
  });

  it("flags by sensitive name", () => {
    expect(isSensitiveByMeta({ name: "password" })).toBe(true);
    expect(isSensitiveByMeta({ name: "user_password" })).toBe(true);
    expect(isSensitiveByMeta({ name: "secret_key" })).toBe(true);
    expect(isSensitiveByMeta({ name: "auth_token" })).toBe(true);
    expect(isSensitiveByMeta({ name: "otp_code" })).toBe(true);
    expect(isSensitiveByMeta({ name: "cvv" })).toBe(true);
    expect(isSensitiveByMeta({ name: "ssn" })).toBe(true);
    expect(isSensitiveByMeta({ name: "credit_card" })).toBe(true);
  });

  it("flags by sensitive id when name is missing", () => {
    expect(isSensitiveByMeta({ id: "passwordField" })).toBe(true);
    expect(isSensitiveByMeta({ id: "auth-token" })).toBe(true);
  });

  it("flags by sensitive autocomplete", () => {
    expect(isSensitiveByMeta({ autocomplete: "current-password" })).toBe(true);
    expect(isSensitiveByMeta({ autocomplete: "new-password" })).toBe(true);
    expect(isSensitiveByMeta({ autocomplete: "one-time-code" })).toBe(true);
    expect(isSensitiveByMeta({ autocomplete: "cc-number" })).toBe(true);
    expect(isSensitiveByMeta({ autocomplete: "cc-csc" })).toBe(true);
    expect(isSensitiveByMeta({ autocomplete: "cc-exp" })).toBe(true);
  });

  it("does not flag normal inputs", () => {
    expect(isSensitiveByMeta({ type: "text", name: "username" })).toBe(false);
    expect(isSensitiveByMeta({ type: "email", name: "email" })).toBe(false);
    expect(isSensitiveByMeta({ name: "search_query" })).toBe(false);
    expect(isSensitiveByMeta({ name: "comment" })).toBe(false);
    expect(isSensitiveByMeta({ autocomplete: "off" })).toBe(false);
    expect(isSensitiveByMeta({ autocomplete: "email" })).toBe(false);
    expect(isSensitiveByMeta({})).toBe(false);
  });

  it("autocomplete regex requires whole-token match", () => {
    // not full tokens
    expect(isSensitiveByMeta({ autocomplete: "old-password-thing" })).toBe(false);
    // valid tokens space-separated
    expect(isSensitiveByMeta({ autocomplete: "username current-password" })).toBe(true);
  });
});

describe("isSensitiveHeader", () => {
  it("flags auth and cookie headers regardless of case", () => {
    expect(isSensitiveHeader("Authorization")).toBe(true);
    expect(isSensitiveHeader("authorization")).toBe(true);
    expect(isSensitiveHeader("Cookie")).toBe(true);
    expect(isSensitiveHeader("set-cookie")).toBe(true);
    expect(isSensitiveHeader("Proxy-Authorization")).toBe(true);
    expect(isSensitiveHeader("X-Api-Key")).toBe(true);
    expect(isSensitiveHeader("x-csrf-token")).toBe(true);
    expect(isSensitiveHeader("X-Auth-Token")).toBe(true);
    expect(isSensitiveHeader("X-Access-Token")).toBe(true);
    expect(isSensitiveHeader("X-Session-Token")).toBe(true);
  });

  it("does not flag normal headers", () => {
    expect(isSensitiveHeader("Content-Type")).toBe(false);
    expect(isSensitiveHeader("Accept")).toBe(false);
    expect(isSensitiveHeader("User-Agent")).toBe(false);
    expect(isSensitiveHeader("X-Request-Id")).toBe(false);
    expect(isSensitiveHeader("Referer")).toBe(false);
  });
});

describe("redactHeaders", () => {
  it("replaces sensitive header values with [REDACTED] and keeps the rest", () => {
    const input = {
      "content-type": "application/json",
      authorization: "Bearer abc.def.ghi",
      cookie: "sid=secret-123",
      "x-request-id": "trace-1",
    };
    expect(redactHeaders(input)).toEqual({
      "content-type": "application/json",
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      "x-request-id": "trace-1",
    });
  });

  it("does not mutate the input object", () => {
    const input = { authorization: "Bearer X" };
    redactHeaders(input);
    expect(input).toEqual({ authorization: "Bearer X" });
  });

  it("returns an empty object when given empty input", () => {
    expect(redactHeaders({})).toEqual({});
  });
});
