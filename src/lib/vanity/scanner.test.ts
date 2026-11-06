import { describe, expect, it } from "vitest";
import { countCandidates, generateCandidates, statusOf, toCompact } from "./scanner";

describe("generateCandidates", () => {
  it("letters only: 676 + 17576 codes", () => {
    const list = generateCandidates(true, true, "letters");
    expect(list.length).toBe(18252);
    expect(list[0]).toBe("aa");
    expect(list.at(-1)).toBe("zzz");
  });
  it("letters + digits: 1296 + 46656 codes", () => {
    expect(countCandidates(true, true, "alnum")).toBe(47952);
    expect(generateCandidates(true, false, "alnum")).toContain("a1");
  });
});

describe("compact results", () => {
  it("keeps 404 as not found, never as available", () => {
    const c = toCompact({ code: "zq", status: "not_found", httpStatus: 404, retryAfterSeconds: null, reason: "", checkedAt: "2026-01-01T00:00:00Z" });
    expect(statusOf(c)).toBe("not_found");
  });
});
