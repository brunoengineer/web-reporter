/**
 * "Copy as Markdown" — a paste-ready bug report for Jira / GitHub / Linear.
 */
import type { ActionEvent, SessionEvent } from "../shared/schema";
import {
  buildSteps,
  computeStats,
  dedupeSteps,
  describeKey,
  failedRequests,
  firstPage,
  fmtClock,
  fmtDate,
  fmtDuration,
  fmtMs,
  fmtRel,
  groupErrors,
  parseUserAgent,
  pathOf,
  sessionDuration,
  shortUrl,
  truncate,
  type ReportData,
  type Step,
} from "./model";

const code = (s: string): string => `\`${s.replace(/`/g, "'")}\``;

export const describeStepText = (e: ActionEvent): string => {
  switch (e.type) {
    case "page":
      return `Open ${e.url}`;
    case "nav":
      return `Navigate (${e.kind}) to ${e.url}`;
    case "click":
      return e.text ? `Click "${truncate(e.text, 60)}" (${code(truncate(e.selector, 80))})` : `Click ${code(truncate(e.selector, 80))}`;
    case "input": {
      const what = e.redacted ? "redacted value" : e.length === 0 ? "cleared value" : `${e.length} char${e.length === 1 ? "" : "s"}`;
      return `Type ${what} into ${code(truncate(e.selector, 80))} (${e.inputType})`;
    }
    case "submit":
      return `Submit ${code(truncate(e.selector, 80))}`;
    case "key":
      return `Press ${code(describeKey(e.key))} in ${code(truncate(e.selector, 60))}`;
    case "note":
      return `Note: ${e.text}`;
  }
};

const describeFollowup = (e: SessionEvent): string | null => {
  if (e.type === "error") return `⚠ ${truncate(e.message.split("\n")[0] ?? "", 200)}${e.source ? ` (${e.source})` : ""}`;
  if (e.type === "console" && e.level === "error") return `⚠ ${truncate(e.message.split("\n")[0] ?? "", 200)}`;
  if (e.type === "network") return `✗ ${e.method} ${pathOf(e.url)} → ${e.status === 0 ? `failed (${e.error ?? "network error"})` : e.status}`;
  if (e.type === "screenshot") return `📷 Screenshot at ${fmtClock(e.ts)}`;
  return null;
};

const stepsMarkdown = (steps: Step[], startedAt: number): string[] => {
  const lines: string[] = [];
  steps.forEach((s, i) => {
    lines.push(`${i + 1}. ${describeStepText(s.event)}  _(+${fmtRel(s.event.ts, startedAt)})_`);
    for (const f of s.followups) {
      const d = describeFollowup(f.event);
      if (d) lines.push(`   - ${d}`);
    }
  });
  return lines;
};

export const buildMarkdown = (data: ReportData): string => {
  const { meta, events } = data;
  const stats = computeStats(events);
  const page = firstPage(events);
  const env = page ? parseUserAgent(page.userAgent, page.platform) : null;
  const steps = dedupeSteps(buildSteps(events));
  const errors = groupErrors(events);
  const failed = failedRequests(events);

  const out: string[] = [];
  out.push(`# ${meta.title.trim() || "Untitled bug report"}`);
  out.push("");
  out.push(
    `**Severity:** ${meta.severity}  ·  **Recorded:** ${fmtDate(meta.startedAt)} (${fmtDuration(sessionDuration(data))})`,
  );
  if (page) out.push(`**URL:** ${page.url}`);
  if (page && env) {
    out.push(
      `**Environment:** ${env.browser} ${env.browserVersion} · ${env.os} · ${page.viewport.w}×${page.viewport.h}` +
        `${page.dpr && page.dpr !== 1 ? ` @${page.dpr}x` : ""} · ${page.language} · ${page.timezone}`,
    );
  }
  out.push(
    `**Captured:** ${stats.errors} error${stats.errors === 1 ? "" : "s"}, ${stats.warnings} warning${stats.warnings === 1 ? "" : "s"}, ` +
      `${failed.length} failed request${failed.length === 1 ? "" : "s"}, ${stats.actions} action${stats.actions === 1 ? "" : "s"}, ` +
      `${stats.shots} screenshot${stats.shots === 1 ? "" : "s"}`,
  );
  out.push("");

  if (meta.notes.trim()) {
    out.push("## Notes");
    out.push("");
    out.push(meta.notes.trim());
    out.push("");
  }

  out.push("## Steps to reproduce");
  out.push("");
  if (steps.length === 0) out.push("_No user actions were recorded._");
  else out.push(...stepsMarkdown(steps, meta.startedAt));
  out.push("");

  if (errors.length > 0) {
    out.push(`## Errors (${stats.errors})`);
    out.push("");
    for (const g of errors.slice(0, 15)) {
      const first = truncate(g.message.split("\n")[0] ?? "", 200);
      out.push(`- ${code(first)}${g.count > 1 ? ` ×${g.count}` : ""} — first at ${fmtClock(g.firstTs)}${g.source ? ` (${g.source})` : ""}`);
    }
    if (errors.length > 15) out.push(`- _…and ${errors.length - 15} more_`);
    out.push("");
  }

  if (failed.length > 0) {
    out.push(`## Failed requests (${failed.length})`);
    out.push("");
    out.push("| Time | Method | Status | URL | Duration |");
    out.push("|---|---|---|---|---|");
    for (const { event: e } of failed.slice(0, 25)) {
      const status = e.status === 0 ? `failed${e.error ? ` (${e.error})` : ""}` : `${e.status}${e.statusText ? ` ${e.statusText}` : ""}`;
      out.push(`| ${fmtClock(e.ts)} | ${e.method} | ${status} | ${shortUrl(e.url, 90).replace(/\|/g, "\\|")} | ${fmtMs(e.duration)} |`);
    }
    if (failed.length > 25) out.push(`\n_…and ${failed.length - 25} more_`);
    out.push("");
  }

  out.push("---");
  out.push(`_Generated by Web Reporter${meta.appVersion ? ` ${meta.appVersion}` : ""}. Full console, network and screenshots are in the attached HTML report._`);
  return out.join("\n");
};

export const buildStepsMarkdown = (data: ReportData): string => {
  const steps = dedupeSteps(buildSteps(data.events));
  if (steps.length === 0) return "_No user actions were recorded._";
  return stepsMarkdown(steps, data.meta.startedAt).join("\n");
};
