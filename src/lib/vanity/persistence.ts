import { CATEGORIES, KINDS } from "./catalog";
import { classifyHttpStatus, isValidCode, MIN_INTERVAL_MS, BATCH_OPTIONS } from "./check-rules";

export const DATA_VERSION = 1;
export interface Recovery { value: unknown; recovered: boolean }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const code = (v: unknown): v is string => typeof v === "string" && isValidCode(v);

/** Accept legacy values; preserve every valid record and never infer availability. */
export function validateSavedData(key: string, input: unknown, initial: unknown): Recovery {
  let value = input;
  if (object(input) && "dvfVersion" in input) {
    if (input.dvfVersion !== DATA_VERSION || !("data" in input)) return { value: initial, recovered: true };
    value = input.data;
  }
  let result: unknown = initial;
  if (key.includes("results")) {
    const out: Record<string, unknown> = {};
    if (object(value)) for (const [c, r] of Object.entries(value)) {
      if (!code(c) || !Array.isArray(r) || r.length !== 3 || !["e", "n", "x"].includes(r[0]) ||
        !(r[1] === null || (number(r[1]) && Number.isInteger(r[1]) && r[1] >= 100 && r[1] <= 599)) || !number(r[2])) continue;
      const status = classifyHttpStatus(r[1]);
      out[c] = [status === "exists" ? "e" : status === "not_found" ? "n" : "x", r[1], r[2]];
    }
    result = out;
  } else if (key.includes("catalog")) {
    result = Array.isArray(value) ? value.filter(v => object(v) && code(v.code) && typeof v.meaning === "string" &&
      CATEGORIES.some(c => c === v.category) && KINDS.some(k => k === v.kind) &&
      (v.favorite === undefined || typeof v.favorite === "boolean") && (v.custom === undefined || typeof v.custom === "boolean")) : initial;
  } else if (key === "dvf:selected") {
    result = Array.isArray(value) ? [...new Set(value.filter(code))] : initial;
  } else if (key.includes("config") && object(initial)) {
    const v = object(value) ? value : {};
    result = { ...initial,
      source: v.source === "catalog" || v.source === "generated" ? v.source : initial.source,
      charset: v.charset === "letters" || v.charset === "alnum" ? v.charset : initial.charset,
      len2: typeof v.len2 === "boolean" ? v.len2 : initial.len2,
      len3: typeof v.len3 === "boolean" ? v.len3 : initial.len3,
      keepAwake: typeof v.keepAwake === "boolean" ? v.keepAwake : initial.keepAwake,
      intervalMs: number(v.intervalMs) ? Math.max(MIN_INTERVAL_MS, v.intervalMs) : initial.intervalMs,
      batch: BATCH_OPTIONS.some(b => b === v.batch) ? v.batch : initial.batch,
    };
  } else if (key.includes("filters") && object(initial)) {
    const v = object(value) ? value : {};
    result = { ...initial,
      query: typeof v.query === "string" ? v.query : initial.query,
      length: ["all", "2", "3"].includes(String(v.length)) ? v.length : initial.length,
      family: ["all", "palavra", "abreviação", "nome", "fonético"].includes(String(v.family)) ? v.family : initial.family,
      language: typeof v.language === "string" ? v.language : initial.language,
      sort: ["relevance", "pronunciation", "aesthetics"].includes(String(v.sort)) ? v.sort : initial.sort,
      limit: number(v.limit) && Number.isInteger(v.limit) && v.limit > 0 ? v.limit : initial.limit,
    };
  } else if (key === "dvf:cooldown-until" || key === "dvf:last-check-at") result = number(value) ? value : initial;
  return { value: result, recovered: JSON.stringify(value) !== JSON.stringify(result) };
}

export function decodeSavedData(key: string, raw: string, initial: unknown): Recovery {
  try { return validateSavedData(key, JSON.parse(raw), initial); }
  catch { return { value: initial, recovered: true }; }
}
export const encodeSavedData = (data: unknown) => JSON.stringify({ dvfVersion: DATA_VERSION, data });
export const recoveryKey = (key: string) => `${key}:recovery:v1`;

export interface StorageIssue { key: string; kind: "quota" | "unavailable" | "recovery"; message: string }
let issues: StorageIssue[] = [];
const listeners = new Set<() => void>();
const retries = new Map<string, () => void>();
const memory = new Map<string, unknown>();
const originals = new Map<string, string>();
export const subscribeStorage = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const getStorageIssues = () => issues;
export const EMPTY_STORAGE_ISSUES: StorageIssue[] = [];
export function reportStorageIssue(key: string, error: unknown, recovery = false) {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  const kind = recovery ? "recovery" : name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" ? "quota" : "unavailable";
  const message = recovery ? "Dados incompletos ou incompatíveis foram recuperados. Os originais permanecem intactos; a recuperação será salva separadamente." :
    kind === "quota" ? "Sem espaço para salvar o progresso. A varredura foi pausada. Os dados anteriores continuam salvos e os novos permanecem nesta aba. Não recarregue antes de baixar uma cópia ou conseguir salvar." :
    "O navegador não conseguiu ler ou salvar os dados. A varredura foi pausada. Mantenha esta aba aberta e baixe uma cópia antes de sair.";
  issues = [...issues.filter(i => i.key !== key || (i.kind === "recovery" && !recovery)), { key, kind, message }];
  listeners.forEach(fn => fn());
}
export function clearStorageError(key: string) {
  const next = issues.filter(i => i.key !== key || i.kind === "recovery");
  if (next.length !== issues.length) { issues = next; listeners.forEach(fn => fn()); }
}
export const hasStorageFailure = () => issues.some(i => i.kind !== "recovery");
export const rememberOriginal = (key: string, raw: string) => originals.set(key, raw);
export const rememberInMemory = (key: string, value: unknown) => memory.set(key, value);
export function registerSaveRetry(key: string, fn: () => void) { retries.set(key, fn); return () => { retries.delete(key); }; }
export const retryStorageSaves = () => retries.forEach(fn => fn());
export const getRecoveryBackup = () => JSON.stringify({ dvfBackupVersion: 1, data: Object.fromEntries(memory), originals: Object.fromEntries(originals) }, null, 2);