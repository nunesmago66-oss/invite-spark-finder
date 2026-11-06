import { describe, expect, it, vi } from "vitest";

import {
  MIN_INTERVAL_MS,
  classifyHttpStatus,
  isValidCode,
  normalizeCheckResult,
  normalizeCode,
  parseRetryAfter,
  rateLimitSourceOf,
  runVerificationQueue,
  toCsv,
  type CheckResult,
} from "./check-rules";

const res = (code: string, httpStatus: number | null, retry: number | null = null): CheckResult => ({
  code,
  status: classifyHttpStatus(httpStatus),
  httpStatus,
  retryAfterSeconds: retry,
  reason: "",
  checkedAt: "2026-01-01T00:00:00Z",
});

describe("classifyHttpStatus", () => {
  it("200 is an existing invite", () => expect(classifyHttpStatus(200)).toBe("exists"));
  it("404 is not found", () => expect(classifyHttpStatus(404)).toBe("not_found"));
  it("429 is inconclusive", () => expect(classifyHttpStatus(429)).toBe("inconclusive"));
  it("other HTTP codes are inconclusive", () => {
    expect(classifyHttpStatus(500)).toBe("inconclusive");
    expect(classifyHttpStatus(403)).toBe("inconclusive");
  });
  it("network failure is inconclusive", () => expect(classifyHttpStatus(null)).toBe("inconclusive"));
});

describe("limits", () => {
  it("waits at least 3 seconds between checks", () => expect(MIN_INTERVAL_MS).toBe(3000));
  it("never goes faster than 3 seconds", async () => {
    const sleep = vi.fn(async () => {});
    await runVerificationQueue({
      codes: ["aa", "bb"], batchLimit: 10, intervalMs: 500, sleep, shouldStop: () => false,
      check: async (c) => res(c, 404),
    });
    expect(sleep).toHaveBeenCalledWith(3000);
  });
});

describe("parseRetryAfter", () => {
  it("reads the header in seconds", () => expect(parseRetryAfter("5")).toBe(5));
  it("uses the larger of header and body", () => expect(parseRetryAfter("2", 7.5)).toBe(7.5));
  it("returns null when absent", () => expect(parseRetryAfter(null)).toBeNull());
});

describe("codes", () => {
  it("accepts 2 and 3 characters only", () => {
    expect(isValidCode("gg")).toBe(true);
    expect(isValidCode("vip")).toBe(true);
    expect(isValidCode("g")).toBe(false);
    expect(isValidCode("abcd")).toBe(false);
  });
  it("normalizes invite links and case", () => {
    expect(normalizeCode(" https://discord.gg/VIP ")).toBe("vip");
  });
});

describe("runVerificationQueue", () => {
  const base = { sleep: vi.fn(async () => {}), shouldStop: () => false };

  it("checks sequentially with a 3s wait between requests", async () => {
    const sleep = vi.fn(async () => {});
    const order: string[] = [];
    const out = await runVerificationQueue({
      ...base,
      sleep,
      codes: ["aa", "bb", "cc"],
      batchLimit: 30, intervalMs: 3000,
      check: async (c) => {
        order.push(c);
        return res(c, 404);
      },
    });
    expect(out.reason).toBe("done");
    expect(order).toEqual(["aa", "bb", "cc"]);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("stops at the first 429 and reports Retry-After", async () => {
    const check = vi.fn(async (c: string) => (c === "bb" ? res(c, 429, 12) : res(c, 200)));
    const out = await runVerificationQueue({
      ...base,
      codes: ["aa", "bb", "cc"],
      batchLimit: 30, intervalMs: 3000,
      check,
    });
    expect(out).toEqual({ reason: "rate_limited", checked: 2, retryAfterSeconds: 12 });
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("auto-pauses after the batch size", async () => {
    const check = vi.fn(async (c: string) => res(c, 404));
    const out = await runVerificationQueue({
      ...base,
      codes: ["aa", "bb", "cc"],
      batchLimit: 1, intervalMs: 3000,
      check,
    });
    expect(out.reason).toBe("batch");
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("stops when the user presses stop", async () => {
    let stop = false;
    const check = vi.fn(async (c: string) => {
      stop = true;
      return res(c, 200);
    });
    const out = await runVerificationQueue({
      ...base,
      shouldStop: () => stop,
      codes: ["aa", "bb"],
      batchLimit: 30, intervalMs: 3000,
      check,
    });
    expect(out.reason).toBe("stopped");
    expect(check).toHaveBeenCalledTimes(1);
  });
});

it("pauses after 3 consecutive errors", async () => {
  const check = vi.fn(async (c: string) => res(c, 500));
  const out = await runVerificationQueue({
    codes: ["aa", "bb", "cc", "dd"], batchLimit: 30, intervalMs: 3000,
    sleep: async () => {}, shouldStop: () => false, check,
  });
  expect(out.reason).toBe("errors");
  expect(check).toHaveBeenCalledTimes(3);
});

describe("normalizeCheckResult", () => {
  it("turns a missing server reply into an error, not a crash", () => {
    expect(normalizeCheckResult("aa", undefined).status).toBe("inconclusive");
  });
  it("rejects a reply for a different code", () => {
    expect(normalizeCheckResult("aa", res("bb", 200)).status).toBe("inconclusive");
  });
  it("HTTP 404 always stays not found", () => {
    const r = normalizeCheckResult("aa", { ...res("aa", 404), status: "exists" });
    expect(r.status).toBe("not_found");
  });
  it("keeps 429 Retry-After", () => {
    const r = normalizeCheckResult("aa", res("aa", 429, 20));
    expect(r).toMatchObject({ status: "inconclusive", httpStatus: 429, retryAfterSeconds: 20 });
  });
});

describe("toCsv", () => {
  it("escapes commas and quotes", () => {
    expect(toCsv(["a", "b"], [['x,y', 'say "hi"']])).toBe('a,b\r\n"x,y","say ""hi"""');
  });
});

describe("429 origin: Discord vs preventive app block", () => {
  it("a 429 that contacted Discord is labelled as coming from Discord", () => {
    const r = normalizeCheckResult("aa", { ...res("aa", 429, 5), discordQueried: true });
    expect(rateLimitSourceOf(r)).toBe("discord");
  });
  it("a preventive block (Discord not contacted) is never labelled as a Discord 429", () => {
    const r = normalizeCheckResult("aa", { ...res("aa", 429, 5), discordQueried: false });
    expect(rateLimitSourceOf(r)).toBe("app_block");
  });
  it("a 429 without origin information stays unknown", () => {
    expect(rateLimitSourceOf(normalizeCheckResult("aa", res("aa", 429, 5)))).toBe("unknown");
  });
  it("still stops at the first 429 and reports its origin", async () => {
    const check = vi.fn(async (c: string) => ({ ...res(c, 429, 7), discordQueried: false }));
    const out = await runVerificationQueue({
      codes: ["aa", "bb", "cc"], batchLimit: 10, intervalMs: 3000,
      sleep: async () => {}, shouldStop: () => false, check,
    });
    expect(out).toMatchObject({ reason: "rate_limited", retryAfterSeconds: 7, rateLimitSource: "app_block", checked: 1 });
    expect(check).toHaveBeenCalledTimes(1);
  });
});
