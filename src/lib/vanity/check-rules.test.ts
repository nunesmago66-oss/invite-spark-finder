import { describe, expect, it, vi } from "vitest";

import {
  MIN_INTERVAL_MS,
  SESSION_LIMIT,
  classifyHttpStatus,
  isValidCode,
  normalizeCode,
  parseRetryAfter,
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
  it("allows at most 30 checks per session", () => expect(SESSION_LIMIT).toBe(30));
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
      remainingBudget: 30,
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
      remainingBudget: 30,
      check,
    });
    expect(out).toEqual({ reason: "rate_limited", checked: 2, retryAfterSeconds: 12 });
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("never exceeds the remaining session budget", async () => {
    const check = vi.fn(async (c: string) => res(c, 404));
    const out = await runVerificationQueue({
      ...base,
      codes: ["aa", "bb", "cc"],
      remainingBudget: 1,
      check,
    });
    expect(out.reason).toBe("budget");
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
      remainingBudget: 30,
      check,
    });
    expect(out.reason).toBe("stopped");
    expect(check).toHaveBeenCalledTimes(1);
  });
});

describe("toCsv", () => {
  it("escapes commas and quotes", () => {
    expect(toCsv(["a", "b"], [['x,y', 'say "hi"']])).toBe('a,b\r\n"x,y","say ""hi"""');
  });
});
