import { STATUS_LABEL, type CheckResult, type CheckStatus } from "./check-rules";

export const LETTERS = "abcdefghijklmnopqrstuvwxyz";
export const DIGITS = "0123456789";

export type Charset = "letters" | "alnum";
export const CHARSET_LABEL: Record<Charset, string> = {
  letters: "Só letras (a–z)",
  alnum: "Letras + números (a–z, 0–9)",
};

export interface ScannerConfig {
  source: "generated" | "catalog";
  len2: boolean;
  len3: boolean;
  charset: Charset;
  intervalMs: number;
  batch: number;
  keepAwake: boolean;
}

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  source: "generated",
  len2: true,
  len3: true,
  charset: "letters",
  intervalMs: 5000,
  batch: 100,
  keepAwake: true,
};

const alphabet = (c: Charset) => (c === "letters" ? LETTERS : LETTERS + DIGITS);

/** All codes of the chosen lengths, shortest first, in lexicographic order. */
export function generateCandidates(len2: boolean, len3: boolean, charset: Charset): string[] {
  const chars = alphabet(charset);
  const out: string[] = [];
  if (len2) for (const a of chars) for (const b of chars) out.push(a + b);
  if (len3) for (const a of chars) for (const b of chars) for (const c of chars) out.push(a + b + c);
  return out;
}

export function countCandidates(len2: boolean, len3: boolean, charset: Charset): number {
  const n = alphabet(charset).length;
  return (len2 ? n ** 2 : 0) + (len3 ? n ** 3 : 0);
}

/* ---------- compact result storage (fits ~48k codes in localStorage) ---------- */

export type StatusKey = "e" | "n" | "x";
/**
 * Origin of an error/rate-limit result: "d" = Discord was contacted,
 * "a" = the app answered by itself without contacting Discord.
 * Stored only on error results (absent on legacy data = origin not recorded).
 */
export type OriginKey = "d" | "a";
/** [status, http status or null, checked-at epoch seconds, origin?] */
export type CompactResult = [StatusKey, number | null, number, OriginKey?];
export type ResultsMap = Record<string, CompactResult>;

const TO_KEY: Record<CheckStatus, StatusKey> = { exists: "e", not_found: "n", inconclusive: "x" };
const FROM_KEY: Record<StatusKey, CheckStatus> = { e: "exists", n: "not_found", x: "inconclusive" };

export function toCompact(r: CheckResult): CompactResult {
  const t = Date.parse(r.checkedAt);
  const base: CompactResult = [TO_KEY[r.status], r.httpStatus, Math.floor((Number.isFinite(t) ? t : Date.now()) / 1000)];
  if (r.status === "inconclusive" && typeof r.discordQueried === "boolean") base.push(r.discordQueried ? "d" : "a");
  return base;
}

export const statusOf = (c: CompactResult): CheckStatus => FROM_KEY[c[0]];

export function describeResult(c: CompactResult): string {
  const [s, http, , origin] = c;
  if (s === "e") return "Existe um convite ativo com este código (HTTP 200).";
  if (s === "n")
    return "Nenhum convite encontrado (HTTP 404). Disponibilidade de vanity URL NÃO confirmada.";
  if (http === 429) {
    if (origin === "d") return "O Discord retornou limite de taxa (HTTP 429).";
    if (origin === "a")
      return "Bloqueio preventivo do app (limite de taxa recente ainda ativo). O Discord não foi consultado.";
    return "Limite de taxa (HTTP 429) — origem não registrada.";
  }
  if (http != null) return `Resposta inesperada (HTTP ${http}).`;
  if (origin === "a") return "Consulta não enviada pelo app (intervalo mínimo). O Discord não foi consultado.";
  return "Falha de rede ou tempo esgotado.";
}

export const statusLabelOf = (c: CompactResult) => STATUS_LABEL[statusOf(c)];

export function formatDuration(ms: number): string {
  const totalMin = Math.ceil(ms / 60000);
  if (totalMin < 1) return "menos de 1 min";
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  return [d && `${d} d`, h && `${h} h`, m && `${m} min`].filter(Boolean).join(" ");
}
