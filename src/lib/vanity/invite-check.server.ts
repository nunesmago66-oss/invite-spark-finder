import {
  MIN_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
  classifyHttpStatus,
  parseRetryAfter,
  type CheckResult,
} from "./check-rules";

// Best-effort, per-isolate protections. The browser queue is the primary limiter.
let blockedUntil = 0;
const lastByClient = new Map<string, number>();

function result(code: string, partial: Omit<CheckResult, "code" | "checkedAt">): CheckResult {
  return { code, checkedAt: new Date().toISOString(), ...partial };
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
      let body: { retry_after?: unknown } = {};
      try {
        body = (await res.json()) as { retry_after?: unknown };
      } catch {
        /* ignore */
      }
      const retry = parseRetryAfter(res.headers.get("retry-after"), body.retry_after) ?? 60;
      blockedUntil = Date.now() + Math.ceil(retry * 1000);
      return result(code, {
        status: "inconclusive",
        httpStatus: 429,
        retryAfterSeconds: retry,
        reason: `O Discord retornou limite de taxa (HTTP 429). Tente após ${Math.ceil(retry)}s.`,
        discordQueried: true,
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
          : `Resposta inesperada do Discord (HTTP ${res.status}).`;
    return result(code, { status, httpStatus: res.status, retryAfterSeconds: null, reason, discordQueried: true });
  } catch (err) {
    console.error("invite check failed", code, err);
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return result(code, {
      status: "inconclusive",
      httpStatus: null,
      retryAfterSeconds: null,
      reason: timedOut ? "Tempo esgotado ao consultar o Discord." : "Falha de rede ao consultar o Discord.",
      discordQueried: true,
    });
  }
}
