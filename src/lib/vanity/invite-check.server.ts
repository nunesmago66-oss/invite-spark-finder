import {
  MAX_SERVER_WAIT_SECONDS,
  MIN_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
  classifyHttpStatus,
  parseRetryAfter,
  type CheckResult,
  type LimitLayer,
} from "./check-rules";

// Best-effort, per-isolate protections. The browser queue is the primary limiter.
let blockedUntil = 0;
const lastByClient = new Map<string, number>();

function result(code: string, partial: Omit<CheckResult, "code" | "checkedAt">): CheckResult {
  return { code, checkedAt: new Date().toISOString(), ...partial };
}

const num = (v: string | null): number | null => {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= MAX_SERVER_WAIT_SECONDS ? n : null;
};

export interface LimitEvidence {
  layer: LimitLayer | null;
  scope: string | null;
  global: boolean | null;
  retryAfterSeconds: number | null;
}

/**
 * Reads a 429 response and decides, from evidence only, whether it came from
 * Discord's API (JSON body with retry_after / X-RateLimit-* headers) or from
 * the Cloudflare protection in front of discord.com (HTML / error 1015 page).
 */
export function readLimitEvidence(headers: Headers, bodyText: string): LimitEvidence {
  const contentType = headers.get("content-type") ?? "";
  let body: { retry_after?: unknown; global?: unknown } | null = null;
  if (contentType.includes("json")) {
    try {
      body = JSON.parse(bodyText) as { retry_after?: unknown; global?: unknown };
    } catch {
      body = null;
    }
  }
  const scope = headers.get("x-ratelimit-scope");
  const globalHeader = headers.get("x-ratelimit-global");
  const looksLikeEdge =
    contentType.includes("text/html") || /error\s*1015|cloudflare ray id|cf-error/i.test(bodyText);
  const hasApiEvidence = !!scope || !!headers.get("x-ratelimit-bucket") || (body !== null && "retry_after" in body);
  const layer: LimitLayer | null = hasApiEvidence ? "discord_api" : looksLikeEdge ? "cloudflare_edge" : null;
  const global =
    typeof body?.global === "boolean" ? body.global : globalHeader != null ? globalHeader.toLowerCase() === "true" : null;
  const retry = parseRetryAfter(headers.get("retry-after"), body?.retry_after);
  return {
    layer,
    scope: scope ? scope.slice(0, 20) : null,
    global,
    retryAfterSeconds: retry != null && retry <= MAX_SERVER_WAIT_SECONDS ? retry : null,
  };
}

/** Seconds to wait before the next request when Discord reports an empty bucket. */
export function readNextAllowed(headers: Headers): number | null {
  const remaining = num(headers.get("x-ratelimit-remaining"));
  if (remaining !== 0) return null;
  return num(headers.get("x-ratelimit-reset-after"));
}

export async function checkInviteOnDiscord(code: string, clientKey: string): Promise<CheckResult> {
  const now = Date.now();

  if (now < blockedUntil) {
    const wait = Math.ceil((blockedUntil - now) / 1000);
    return result(code, {
      status: "inconclusive",
      httpStatus: 429,
      retryAfterSeconds: wait,
      reason: `Bloqueio preventivo do app: um limite de taxa do Discord recebido há pouco ainda está ativo. Nenhuma consulta foi enviada ao Discord. Aguarde ${wait}s.`,
      discordQueried: false,
      errorKind: "app_block",
    });
  }

  const last = lastByClient.get(clientKey) ?? 0;
  // Small tolerance for network latency; the client waits a full MIN_INTERVAL_MS.
  if (now - last < MIN_INTERVAL_MS - 500) {
    return result(code, {
      status: "inconclusive",
      httpStatus: null,
      retryAfterSeconds: null,
      reason: "Consultas muito rápidas. Nenhuma consulta foi enviada ao Discord. Aguarde alguns segundos.",
      discordQueried: false,
      errorKind: "app_throttle",
    });
  }
  if (lastByClient.size > 5000) lastByClient.clear();
  lastByClient.set(clientKey, now);

  try {
    const res = await fetch(
      `https://discord.com/api/v10/invites/${encodeURIComponent(code)}?with_counts=false`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "DiscordVanityFinder (public invite lookup, 1.0)",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (res.status === 429) {
      let text = "";
      try {
        text = (await res.text()).slice(0, 4000);
      } catch {
        /* ignore */
      }
      const ev = readLimitEvidence(res.headers, text);
      const retry = ev.retryAfterSeconds ?? 60;
      blockedUntil = Date.now() + Math.ceil(retry * 1000);
      // Diagnostic only: no user data, no IPs, no credentials.
      console.warn("discord 429", {
        code,
        layer: ev.layer ?? "unknown",
        scope: ev.scope,
        global: ev.global,
        retryAfter: ev.retryAfterSeconds,
        contentType: res.headers.get("content-type"),
        cfRay: res.headers.get("cf-ray"),
      });
      const who =
        ev.layer === "cloudflare_edge"
          ? "A proteção da Cloudflare na frente do Discord bloqueou a consulta (HTTP 429)."
          : "O Discord retornou limite de taxa (HTTP 429).";
      const scope = ev.scope ? ` Escopo: ${ev.scope}.` : ev.global ? " Limite global." : "";
      return result(code, {
        status: "inconclusive",
        httpStatus: 429,
        retryAfterSeconds: retry,
        reason: `${who}${scope} Tente após ${Math.ceil(retry)}s.`,
        discordQueried: true,
        limitLayer: ev.layer,
        limitScope: ev.scope,
        limitGlobal: ev.global,
        errorKind: "rate_limit",
      });
    }

    // Body is not needed; drain it to free the connection.
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }

    const status = classifyHttpStatus(res.status);
    const reason =
      status === "exists"
        ? "Existe um convite ativo com este código (HTTP 200)."
        : status === "not_found"
          ? "Nenhum convite encontrado (HTTP 404). Isso NÃO confirma disponibilidade para vanity URL."
          : res.status >= 500
            ? `Falha temporária do servidor do Discord (HTTP ${res.status}). Não é um resultado.`
            : `Resposta inesperada do Discord (HTTP ${res.status}).`;
    return result(code, {
      status,
      httpStatus: res.status,
      retryAfterSeconds: null,
      reason,
      discordQueried: true,
      nextAllowedInSeconds: status === "inconclusive" ? null : readNextAllowed(res.headers),
      errorKind: status === "inconclusive" ? (res.status >= 500 ? "server_error" : "unexpected") : null,
    });
  } catch (err) {
    console.error("invite check failed", code, err);
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return result(code, {
      status: "inconclusive",
      httpStatus: null,
      retryAfterSeconds: null,
      reason: timedOut
        ? "Tempo esgotado ao consultar o Discord. Não é um resultado."
        : "Falha de conexão ao consultar o Discord. Não é um resultado.",
      discordQueried: true,
      errorKind: timedOut ? "timeout" : "network",
    });
  }
}
