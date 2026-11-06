/** Client-safe rules shared by the server check and the browser queue. */

export const MIN_INTERVAL_MS = 3000;
export const SESSION_LIMIT = 30;
export const REQUEST_TIMEOUT_MS = 8000;

export type CheckStatus = "exists" | "not_found" | "inconclusive";

export const STATUS_LABEL: Record<CheckStatus, string> = {
  exists: "Convite existente",
  not_found: "Não encontrado",
  inconclusive: "Inconclusivo",
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

/** 200 → exists, 404 → not found, everything else (incl. no response) → inconclusive. */
export function classifyHttpStatus(httpStatus: number | null): CheckStatus {
  if (httpStatus === 200) return "exists";
  if (httpStatus === 404) return "not_found";
  return "inconclusive";
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

export type QueueStopReason = "done" | "stopped" | "rate_limited" | "budget" | "error";

export interface QueueOptions {
  codes: string[];
  remainingBudget: number;
  initialDelayMs?: number;
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
 * Strictly sequential: one request at a time, at least MIN_INTERVAL_MS between
 * requests, stops at the first rate limit (429) and never exceeds the budget.
 */
export async function runVerificationQueue(opts: QueueOptions): Promise<QueueOutcome> {
  const { codes, check, sleep, shouldStop } = opts;
  let checked = 0;
  for (let i = 0; i < codes.length; i++) {
    if (shouldStop()) return { reason: "stopped", checked, retryAfterSeconds: null };
    if (checked >= opts.remainingBudget) return { reason: "budget", checked, retryAfterSeconds: null };
    const delay = i === 0 ? Math.max(0, opts.initialDelayMs ?? 0) : MIN_INTERVAL_MS;
    if (delay > 0) {
      await sleep(delay);
      if (shouldStop()) return { reason: "stopped", checked, retryAfterSeconds: null };
    }
    const code = codes[i] as string;
    opts.onStart?.(code, i);
    const result = await check(code);
    checked++;
    opts.onResult?.(result, i);
    if (result.httpStatus === 429) {
      return { reason: "rate_limited", checked, retryAfterSeconds: result.retryAfterSeconds };
    }
  }
  return { reason: "done", checked, retryAfterSeconds: null };
}

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
