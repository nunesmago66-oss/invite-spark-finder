import { describe, expect, it } from "vitest";
import { decodeSavedData, encodeSavedData, validateSavedData, reportStorageIssue, getStorageIssues, clearStorageError } from "./persistence";
import { DEFAULT_SCANNER_CONFIG } from "./scanner";
import { DEFAULT_CATALOG } from "./catalog";
import { generateMeaningCandidates } from "./meaning-generator";

describe("safe persistence", () => {
  it("loads legacy progress unchanged", () => {
    const data = { aa: ["e", 200, 100], bb: ["n", 404, 101], cc: ["x", 429, 102] };
    expect(decodeSavedData("dvf:results:v1", JSON.stringify(data), {})).toEqual({ value: data, recovered: false });
  });
  it("round trips versioned data", () => {
    const data = { aa: ["n", 404, 100] };
    expect(decodeSavedData("dvf:meaning-results:v1", encodeSavedData(data), {}).value).toEqual(data);
  });
  it("keeps valid results when other records are corrupt", () => {
    expect(validateSavedData("dvf:results:v1", { aa: ["n", 404, 100], bb: ["wat"], cc: null }, {}).value).toEqual({ aa: ["n", 404, 100] });
  });
  it("404 can never be restored as existing", () => {
    expect(validateSavedData("dvf:results:v1", { aa: ["e", 404, 100] }, {}).value).toEqual({ aa: ["n", 404, 100] });
  });
  it("handles corrupt JSON and unknown versions without trusting them", () => {
    expect(decodeSavedData("dvf:results:v1", "{broken", {}).recovered).toBe(true);
    expect(decodeSavedData("dvf:results:v1", '{"dvfVersion":999,"data":{}}', {}).recovered).toBe(true);
  });
  it("recovers partial settings and preserves the 3-second floor", () => {
    expect(validateSavedData("dvf:scanner-config:v1", { intervalMs: 1, len2: false }, DEFAULT_SCANNER_CONFIG).value).toEqual({ ...DEFAULT_SCANNER_CONFIG, intervalMs: 3000, len2: false });
  });
  it("preserves catalog edits, favorites and selection", () => {
    const catalog = [...DEFAULT_CATALOG, { code: "zz", meaning: "Meu código", category: "outros", kind: "personalizado", custom: true, favorite: true }];
    expect(validateSavedData("dvf:catalog:v1", catalog, DEFAULT_CATALOG)).toEqual({ value: catalog, recovered: false });
    expect(validateSavedData("dvf:selected", ["gg", "zz"], []).value).toEqual(["gg", "zz"]);
  });
  it("preserves exactly 3623 suggestions", () => expect(generateMeaningCandidates()).toHaveLength(3623));
  it("reports quota and other errors instead of failing silently", () => {
    reportStorageIssue("test-quota", { name: "QuotaExceededError" });
    expect(getStorageIssues().find(i => i.key === "test-quota")?.kind).toBe("quota");
    reportStorageIssue("test-other", { name: "SecurityError" });
    expect(getStorageIssues().find(i => i.key === "test-other")?.kind).toBe("unavailable");
    clearStorageError("test-quota"); clearStorageError("test-other");
  });
});