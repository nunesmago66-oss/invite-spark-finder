import { useServerFn } from "@tanstack/react-start";
import { Hourglass, ListChecks, Loader2, Play, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  MIN_INTERVAL_MS,
  SESSION_LIMIT,
  runVerificationQueue,
  type CheckResult,
} from "@/lib/vanity/check-rules";
import { checkInvite } from "@/lib/vanity/invite-check.functions";
import { usePersistentState } from "@/lib/vanity/use-persistent-state";

import { EmptyState, StatusBadge, WarningBanner } from "./shared";

interface Props {
  selected: string[];
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  onResult: (result: CheckResult) => void;
  onGoCandidates: () => void;
  onGoConfirm: () => void;
}

export function VerifyTab({ selected, setSelected, onResult, onGoCandidates, onGoConfirm }: Props) {
  const checkFn = useServerFn(checkInvite);
  const [sessionUsed, setSessionUsed] = usePersistentState("dvf:session-used", 0, "session");
  const [cooldownUntil, setCooldownUntil] = usePersistentState("dvf:cooldown-until", 0, "session");
  const [lastCheckAt, setLastCheckAt] = usePersistentState("dvf:last-check-at", 0, "session");
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [nextAt, setNextAt] = useState(0);
  const [runResults, setRunResults] = useState<CheckResult[]>([]);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const stopRef = useRef(false);
  const lastCheckRef = useRef(0);
  lastCheckRef.current = Math.max(lastCheckRef.current, lastCheckAt);

  const cooling = cooldownUntil > now;
  useEffect(() => {
    if (!running && !cooling) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [running, cooling]);

  const remaining = Math.max(0, SESSION_LIMIT - sessionUsed);
  const queueSize = Math.min(selected.length, remaining);

  function sleep(ms: number) {
    setNextAt(Date.now() + ms);
    return new Promise<void>((resolve) => {
      const end = Date.now() + ms;
      const tick = () => {
        if (stopRef.current || Date.now() >= end) {
          setNextAt(0);
          resolve();
        } else setTimeout(tick, 100);
      };
      tick();
    });
  }

  async function start() {
    if (running || cooling || queueSize === 0) return;
    const codes = selected.slice(0, queueSize);
    stopRef.current = false;
    setRunning(true);
    setMessage(null);
    setRunResults([]);
    setProgress({ done: 0, total: codes.length });

    const outcome = await runVerificationQueue({
      codes,
      remainingBudget: remaining,
      initialDelayMs: lastCheckRef.current + MIN_INTERVAL_MS - Date.now(),
      sleep,
      shouldStop: () => stopRef.current,
      onStart: (code) => {
        setCurrent(code);
        lastCheckRef.current = Date.now();
        setLastCheckAt(lastCheckRef.current);
      },
      check: async (code) => {
        try {
          return await checkFn({ data: { code } });
        } catch (err) {
          console.error(err);
          stopRef.current = true;
          setMessage({
            tone: "error",
            text: "A função de verificação não respondeu. A fila foi interrompida e nenhum resultado foi simulado. Tente novamente mais tarde.",
          });
          return {
            code,
            status: "inconclusive",
            httpStatus: null,
            retryAfterSeconds: null,
            reason: "Erro ao chamar a função de verificação.",
            checkedAt: new Date().toISOString(),
          };
        }
      },
      onResult: (result) => {
        setSessionUsed((n) => n + 1);
        setProgress((p) => ({ ...p, done: p.done + 1 }));
        setRunResults((r) => [result, ...r]);
        onResult(result);
      },
    });

    setRunning(false);
    setCurrent(null);
    setNextAt(0);

    if (outcome.reason === "rate_limited") {
      const secs = Math.max(outcome.retryAfterSeconds ?? 60, MIN_INTERVAL_MS / 1000);
      setCooldownUntil(Date.now() + Math.ceil(secs * 1000));
      setNow(Date.now());
      setMessage({
        tone: "error",
        text: `Limite de requisições atingido (429). A fila foi interrompida. Aguarde ${Math.ceil(secs)}s antes de tentar de novo.`,
      });
    } else if (outcome.reason === "stopped") {
      setMessage((m) => m ?? { tone: "info", text: `Fila parada após ${outcome.checked} consulta(s).` });
    } else if (outcome.reason === "budget") {
      setMessage({ tone: "info", text: "Limite de 30 consultas por sessão atingido." });
    } else {
      toast.success(`${outcome.checked} código(s) verificado(s)`);
      if (selected.length > queueSize) {
        setMessage({
          tone: "info",
          text: `Limite da sessão atingido: ${selected.length - queueSize} código(s) não foram verificados.`,
        });
      }
    }
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const cooldownSecs = Math.ceil((cooldownUntil - now) / 1000);
  const nextSecs = nextAt ? Math.max(0, Math.ceil((nextAt - now) / 1000)) : 0;

  return (
    <div className="space-y-4">
      <WarningBanner />

      <section className="space-y-2 rounded-lg border bg-card p-3 text-sm">
        <h2 className="font-semibold">Como a verificação funciona</h2>
        <p className="text-muted-foreground">
          Consulta o endpoint público de convites do Discord pelo nosso servidor, um código por vez.
          Os únicos resultados possíveis são:
        </p>
        <ul className="space-y-1.5">
          <li className="flex flex-wrap items-center gap-2">
            <StatusBadge status="exists" /> já existe um convite com esse código (HTTP 200).
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <StatusBadge status="not_found" /> nenhum convite encontrado (HTTP 404) —{" "}
            <strong>não</strong> confirma disponibilidade.
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <StatusBadge status="inconclusive" /> limite de requisições, erro ou falha de rede.
          </li>
        </ul>
        <p className="text-xs text-muted-foreground">
          Regras: intervalo mínimo de 3 s entre consultas, sem consultas simultâneas, máximo de{" "}
          {SESSION_LIMIT} por sessão e parada imediata no primeiro limite de requisições (respeitando
          Retry-After). Sem login, tokens ou proxies.
        </p>
      </section>

      <section className="space-y-2 rounded-lg border bg-card p-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Consultas nesta sessão</span>
          <span className="font-mono">
            {sessionUsed}/{SESSION_LIMIT}
          </span>
        </div>
        <Progress value={(sessionUsed / SESSION_LIMIT) * 100} aria-label="Consultas usadas na sessão" />
        {remaining === 0 && (
          <p className="text-xs text-muted-foreground">
            Limite da sessão atingido. Feche esta aba e abra de novo mais tarde para uma nova sessão.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Fila ({selected.length})</h2>
          {selected.length > 0 && !running && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelected([])}>
              Limpar
            </Button>
          )}
        </div>

        {selected.length === 0 ? (
          <EmptyState icon={ListChecks} title="Nenhum candidato selecionado">
            <p>Na aba Candidatos, toque em “Selecionar” nos códigos que deseja verificar.</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onGoCandidates}>
              Ir para Candidatos
            </Button>
          </EmptyState>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="Códigos na fila">
            {selected.map((code, i) => (
              <li
                key={code}
                className={
                  "flex items-center gap-1 rounded-full border bg-card py-1 pl-3 pr-1 font-mono text-sm " +
                  (i >= queueSize ? "opacity-50" : "") +
                  (current === code ? " border-primary ring-1 ring-primary" : "")
                }
              >
                {code}
                <button
                  type="button"
                  disabled={running}
                  onClick={() => setSelected((s) => s.filter((c) => c !== code))}
                  className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-40"
                  aria-label={`Remover ${code} da fila`}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          {running ? (
            <Button
              type="button"
              variant="destructive"
              className="h-11 flex-1"
              onClick={() => {
                stopRef.current = true;
              }}
            >
              <Square aria-hidden /> Parar
            </Button>
          ) : (
            <Button
              type="button"
              className="h-11 flex-1"
              disabled={cooling || queueSize === 0}
              onClick={start}
            >
              <Play aria-hidden />
              {cooling ? `Aguarde ${cooldownSecs}s` : `Verificar selecionados (${queueSize})`}
            </Button>
          )}
        </div>

        {cooling && !running && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Hourglass className="size-4" aria-hidden /> Pausa por limite de requisições:{" "}
            {cooldownSecs}s restantes.
          </p>
        )}

        {running && (
          <div className="space-y-2 rounded-lg border bg-card p-3" role="status" aria-live="polite">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {nextSecs > 0
                ? `Próxima consulta em ${nextSecs}s…`
                : current
                  ? `Verificando “${current}”…`
                  : "Preparando…"}
              <span className="ml-auto font-mono text-xs">
                {progress.done}/{progress.total}
              </span>
            </div>
            <Progress value={pct} aria-label="Progresso da fila" />
          </div>
        )}

        {message && (
          <p
            role="alert"
            className={
              message.tone === "error"
                ? "rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                : "rounded-md border bg-muted p-3 text-sm"
            }
          >
            {message.text}
          </p>
        )}
      </section>

      {runResults.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">Resultados desta execução</h2>
          <ul className="space-y-2">
            {runResults.map((r) => (
              <li key={r.code + r.checkedAt} className="rounded-lg border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg font-semibold">{r.code}</span>
                  <StatusBadge status={r.status} />
                  {r.httpStatus != null && (
                    <span className="text-xs text-muted-foreground">HTTP {r.httpStatus}</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{r.reason}</p>
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" className="w-full" onClick={onGoConfirm}>
            Como confirmar uma vanity URL no Discord
          </Button>
        </section>
      )}
    </div>
  );
}
