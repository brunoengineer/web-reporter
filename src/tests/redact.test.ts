import { describe, expect, it } from "vitest";
import { isSensitiveByMeta, isSensitiveInputType } from "../shared/redact";

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
