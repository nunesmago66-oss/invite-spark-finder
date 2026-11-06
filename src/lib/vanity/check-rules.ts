/** Client-safe rules shared by the server check and the browser scanner. */

/** Hard floor between two consecutive requests; the user can only choose slower speeds. */
export const MIN_INTERVAL_MS = 3000;
export const INTERVAL_OPTIONS_MS = [3000, 5000, 10000, 20000, 30000] as const;
/** Scanner auto-pauses after this many checks; the user must tap "Retomar". */
export const BATCH_OPTIONS = [50, 100, 250] as const;
/** Consecutive errors (non-429) that pause the scanner. */
export const MAX_CONSECUTIVE_ERRORS = 3;
export const REQUEST_TIMEOUT_MS = 8000;

export type CheckStatus = "exists" | "not_found" | "inconclusive";

export const STATUS_LABEL: Record<CheckStatus, string> = {
  exists: "Convite existente",
  not_found: "Não encontrado — disponibilidade não confirmada",
  inconclusive: "Erro/limite de taxa",
};

export interface CheckResult {
  code: string;
  status: CheckStatus;
  httpStatus: number | null;
  retryAfterSeconds: number | null;
  reason: string;
  checkedAt: string;
}

/** Vanity codes: lowercase letters, digits and hyphen, 2–3 characters here. */
const CODE_RE = /^[a-z0-9-]{2,3}$/;

export function normalizeCode(raw: string): string {
  return raw
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?(discord\.gg\/|discord\.com\/invite\/)/i, "")
    .toLowerCase();
}

export function isValidCode(code: string): boolean {
  return CODE_RE.test(code) && !code.startsWith("-") && !code.endsWith("-");
}

/** 200 → exists, 404 → not found, everything else (incl. no response) → error/rate limit. */
export function classifyHttpStatus(httpStatus: number | null): CheckStatus {
  if (httpStatus === 200) return "exists";
  if (httpStatus === 404) return "not_found";
  return "inconclusive";
}

/**
 * Accepts only a well-formed CheckResult for `code`; anything else (missing,
 * malformed, wrong code) becomes an error result so the scanner never crashes.
 */
export function normalizeCheckResult(code: string, raw: unknown): CheckResult {
  const r = raw as Partial<CheckResult> | null | undefined;
  const http = typeof r?.httpStatus === "number" ? r.httpStatus : null;
  if (!r || typeof r !== "object" || r.code !== code || typeof r.status !== "string") {
    return {
      code,
      status: "inconclusive",
      httpStatus: null,
      retryAfterSeconds: null,
      reason: "Resposta inválida da função de verificação.",
      checkedAt: new Date().toISOString(),
    };
  }
  return {
    code,
    // Re-derive status from the HTTP code so a 404 can never be shown as anything else.
    status: classifyHttpStatus(http),
    httpStatus: http,
    retryAfterSeconds:
      typeof r.retryAfterSeconds === "number" && Number.isFinite(r.retryAfterSeconds)
        ? r.retryAfterSeconds
        : null,
    reason: typeof r.reason === "string" ? r.reason : "",
    checkedAt: typeof r.checkedAt === "string" ? r.checkedAt : new Date().toISOString(),
  };
}

/** Larger of Retry-After header (seconds) and JSON body retry_after (seconds). */
export function parseRetryAfter(header: string | null, bodyRetryAfter?: unknown): number | null {
  const values: number[] = [];
  if (header != null) {
    const n = Number(header);
    if (Number.isFinite(n) && n >= 0) values.push(n);
  }
  if (typeof bodyRetryAfter === "number" && Number.isFinite(bodyRetryAfter) && bodyRetryAfter >= 0) {
    values.push(bodyRetryAfter);
  }
  return values.length ? Math.max(...values) : null;
}

export const clampInterval = (ms: number) =>
  Number.isFinite(ms) ? Math.max(MIN_INTERVAL_MS, ms) : MIN_INTERVAL_MS;

export type QueueStopReason = "done" | "stopped" | "rate_limited" | "batch" | "errors";

export interface QueueOptions {
  codes: string[];
  batchLimit: number;
  intervalMs: number;
  initialDelayMs?: number;
  maxConsecutiveErrors?: number;
  check: (code: string) => Promise<CheckResult>;
  sleep: (ms: number) => Promise<void>;
  shouldStop: () => boolean;
  onStart?: (code: string, index: number) => void;
  onResult?: (result: CheckResult, index: number) => void;
}

export interface QueueOutcome {
  reason: QueueStopReason;
  checked: number;
  retryAfterSeconds: number | null;
}

/**
 * Strictly sequential: one request at a time, waits at least MIN_INTERVAL_MS
 * between requests, pauses at the first rate limit (429), after `batchLimit`
 * checks, or after too many consecutive errors.
 */
export async function runVerificationQueue(opts: QueueOptions): Promise<QueueOutcome> {
  const { codes, check, sleep, shouldStop } = opts;
  const interval = clampInterval(opts.intervalMs);
  const maxErrors = opts.maxConsecutiveErrors ?? MAX_CONSECUTIVE_ERRORS;
  let checked = 0;
  let consecutiveErrors = 0;
  const out = (reason: QueueStopReason, retryAfterSeconds: number | null = null): QueueOutcome => ({
    reason,
    checked,
    retryAfterSeconds,
  });

  for (let i = 0; i < codes.length; i++) {
    if (shouldStop()) return out("stopped");
    if (checked >= opts.batchLimit) return out("batch");
    const delay = i === 0 ? Math.max(0, opts.initialDelayMs ?? 0) : interval;
    if (delay > 0) {
      await sleep(delay);
      if (shouldStop()) return out("stopped");
    }
    const code = codes[i] as string;
    opts.onStart?.(code, i);
    const result = await check(code);
    checked++;
    opts.onResult?.(result, i);
    if (result.httpStatus === 429) return out("rate_limited", result.retryAfterSeconds);
    if (result.status === "inconclusive") {
      consecutiveErrors++;
      if (consecutiveErrors >= maxErrors) return out("errors");
    } else {
      consecutiveErrors = 0;
    }
  }
  return out("done");
}

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
