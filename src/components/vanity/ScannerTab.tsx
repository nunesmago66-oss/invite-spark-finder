import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Hourglass, ListChecks, Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { inviteLabel, inviteUrl } from "@/lib/vanity/browser";
import {
  BATCH_OPTIONS,
  INTERVAL_OPTIONS_MS,
  MAX_CONSECUTIVE_ERRORS,
  CLIENT_TIMEOUT_MS,
  MIN_INTERVAL_MS,
  STATUS_LABEL,
  clampInterval,
  normalizeCheckResult,
  runVerificationQueue,
  type CheckResult,
} from "@/lib/vanity/check-rules";
import { checkInvite } from "@/lib/vanity/invite-check.functions";
import {
  CHARSET_LABEL,
  formatDuration,
  generateCandidates,
  toCompact,
  type Charset,
  type ResultsMap,
  type ScannerConfig,
} from "@/lib/vanity/scanner";
import { useWakeLock } from "@/lib/vanity/use-wake-lock";
import { acquireScanLock, type ScanLock } from "@/lib/vanity/scan-lock";
import { decodeSavedData, hasStorageFailure, readSavedTiming, subscribeStorage } from "@/lib/vanity/persistence";
import { cn } from "@/lib/utils";

import { EmptyState, NativeSelect, StatusBadge, WarningBanner } from "./shared";

interface Props {
  candidateCodes?: string[];
  meaningMode?: boolean;
  blocked?: boolean;
  cooldownUntil: number;
  setCooldownUntil: React.Dispatch<React.SetStateAction<number>>;
  lastCheckAt: number;
  setLastCheckAt: React.Dispatch<React.SetStateAction<number>>;
  config: ScannerConfig;
  setConfig: React.Dispatch<React.SetStateAction<ScannerConfig>>;
  selected: string[];
  results: ResultsMap;
  setResults: React.Dispatch<React.SetStateAction<ResultsMap>>;
  running: boolean;
  setRunning: (running: boolean) => void;
  onGoCatalog: () => void;
  onGoResults: () => void;
}

type Msg = { tone: "info" | "error"; text: string };

export function ScannerTab({
  candidateCodes,
  meaningMode = false,
  blocked = false,
  cooldownUntil,
  setCooldownUntil,
  lastCheckAt,
  setLastCheckAt,
  config,
  setConfig,
  selected,
  results,
  setResults,
  running,
  setRunning,
  onGoCatalog,
  onGoResults,
}: Props) {
  const checkFn = useServerFn(checkInvite);
  const [current, setCurrent] = useState<string | null>(null);
  const [nextAt, setNextAt] = useState(0);
  const [recent, setRecent] = useState<CheckResult[]>([]);
  const [message, setMessage] = useState<Msg | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const stopRef = useRef(false);
  const pauseReasonRef = useRef<"user" | "hidden" | null>(null);
  const lastCheckRef = useRef(0);
  const lockRef = useRef<ScanLock | null>(null);
  const acquiringRef = useRef(false);
  lastCheckRef.current = Math.max(lastCheckRef.current, lastCheckAt);

  const wakeLockSupported = useWakeLock(running && config.keepAwake);
  const interval = clampInterval(config.intervalMs);
  const cooling = cooldownUntil > now;

  useEffect(() => subscribeStorage(() => {
    if (hasStorageFailure()) stopRef.current = true;
  }), []);
  useEffect(() => () => { stopRef.current = true; }, []);

  useEffect(() => {
    if (!running && !cooling) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [running, cooling]);

  // iOS Safari suspends background tabs: pause cleanly instead of producing failed requests.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden" && running) {
        pauseReasonRef.current = "hidden";
        stopRef.current = true;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [running]);

  const candidates = useMemo(
    () =>
      candidateCodes ?? (config.source === "generated"
        ? generateCandidates(config.len2, config.len3, config.charset)
        : selected),
    [candidateCodes, config.source, config.len2, config.len3, config.charset, selected],
  );

  const stats = useMemo(() => {
    let tested = 0,
      e = 0,
      n = 0,
      x = 0;
    for (const c of candidates) {
      const r = results[c];
      if (!r) continue;
      tested++;
      if (r[0] === "e") e++;
      else if (r[0] === "n") n++;
      else x++;
    }
    return { tested, e, n, x };
  }, [candidates, results]);

  const total = candidates.length;
  const pending = total - stats.tested;
  const pct = total ? (stats.tested / total) * 100 : 0;

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
    if (running || cooling || blocked || acquiringRef.current) return;
    if (hasStorageFailure()) {
      setMessage({ tone: "error", text: "A verificação está pausada porque não foi possível salvar ou ler o progresso. Baixe uma cópia e tente salvar novamente." });
      return;
    }
    acquiringRef.current = true;
    let lock: ScanLock | null;
    try { lock = await acquireScanLock(); }
    catch {
      acquiringRef.current = false;
      setMessage({ tone: "error", text: "Este navegador não conseguiu proteger a execução entre abas. A verificação não foi iniciada; catálogo, sugestões e exportações continuam disponíveis." });
      return;
    }
    acquiringRef.current = false;
    if (!lock) {
      setMessage({ tone: "info", text: "Outra aba está executando uma verificação. Pause ou aguarde a conclusão nessa aba antes de iniciar aqui." });
      return;
    }
    lockRef.current = lock;
    try {
    // Re-read under the lock: this tab may have been open while another tab scanned.
    const read = (key: string, fallback: unknown) => {
      const raw = localStorage.getItem(`${key}:recovery:v1`) ?? localStorage.getItem(key);
      return raw === null ? fallback : decodeSavedData(key, raw, fallback).value;
    };
    // Largest valid wait across memory, the original key and the recovery copy.
    const savedCooldown = readSavedTiming(localStorage, "dvf:cooldown-until", cooldownUntil);
    const savedLast = readSavedTiming(localStorage, "dvf:last-check-at", lastCheckAt);
    if (savedCooldown > Date.now()) {
      setCooldownUntil(savedCooldown); setNow(Date.now()); return;
    }
    lastCheckRef.current = Math.max(lastCheckRef.current, savedLast);
    const savedResults = read(meaningMode ? "dvf:meaning-results:v1" : "dvf:results:v1", results) as ResultsMap;
    const queue = candidates.filter((c) => !results[c] && !savedResults[c]);
    if (queue.length === 0 || hasStorageFailure() || document.visibilityState === "hidden") return;
    stopRef.current = false;
    pauseReasonRef.current = null;
    setRunning(true);
    setMessage(null);

    let lastLimit: CheckResult | null = null;
    const outcome = await runVerificationQueue({
      codes: queue,
      batchLimit: config.batch,
      intervalMs: interval,
      initialDelayMs: lastCheckRef.current + interval - Date.now(),
      sleep,
      shouldStop: () => stopRef.current || hasStorageFailure() || !lockRef.current?.held(),
      onStart: (code) => {
        setCurrent(code);
        lastCheckRef.current = Date.now();
        setLastCheckAt(lastCheckRef.current);
      },
      check: async (code) => {
        if (!lockRef.current?.held()) throw new Error("Bloqueio entre abas perdido");
        // Client-side deadline so a stuck request can never freeze the queue.
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, CLIENT_TIMEOUT_MS);
        try {
          return normalizeCheckResult(code, await checkFn({ data: { code }, signal: controller.signal }));
        } catch (err) {
          console.error(err);
          return {
            code,
            status: "inconclusive",
            httpStatus: null,
            retryAfterSeconds: null,
            reason: timedOut
              ? "A função de verificação não respondeu a tempo. Não é um resultado."
              : "A função de verificação não respondeu. Não é um resultado.",
            checkedAt: new Date().toISOString(),
            discordQueried: null,
            errorKind: timedOut ? "timeout" : "network",
          };
        } finally {
          clearTimeout(timer);
        }
      },
      onResult: (r) => {
        if (r.httpStatus === 429) lastLimit = r;
        setResults((prev) => ({ ...prev, [r.code]: toCompact(r) }));
        setRecent((list) => [r, ...list].slice(0, 6));
      },
    });

    setRunning(false);
    setCurrent(null);
    setNextAt(0);

    switch (outcome.reason) {
      case "rate_limited": {
        const secs = Math.ceil(Math.max(outcome.retryAfterSeconds ?? 60, MIN_INTERVAL_MS / 1000));
        const until = Date.now() + secs * 1000;
        // Never shorten a longer wait that is already active.
        setCooldownUntil((prev) => Math.max(prev, until));
        setNow(Date.now());
        const limit = lastLimit as CheckResult | null;
        const scope = limit?.limitScope ? ` Escopo informado: ${limit.limitScope}.` : limit?.limitGlobal ? " Limite global." : "";
        const origin =
          outcome.rateLimitSource === "discord"
            ? `O Discord retornou limite de taxa (HTTP 429).${scope}`
            : outcome.rateLimitSource === "cloudflare_edge"
            ? "A proteção da Cloudflare na frente do Discord bloqueou a consulta (HTTP 429). Esse bloqueio costuma atingir o endereço de saída compartilhado do servidor do site, não a sua conta."
            : outcome.rateLimitSource === "app_block"
              ? "Bloqueio preventivo do app: um limite de taxa do Discord recebido há pouco ainda está ativo, por isso nenhuma consulta foi enviada ao Discord."
              : "Limite de taxa (HTTP 429) — não foi possível confirmar se veio do Discord ou de um bloqueio preventivo do app.";
        setMessage({
          tone: "error",
          text: `${origin} A varredura foi pausada e não será retomada sozinha. Aguarde ${secs}s e toque em “Retomar”. O app não tenta contornar esse limite.`,
        });
        break;
      }
      case "batch":
        setMessage({
          tone: "info",
          text: `Pausa automática após ${outcome.checked} verificações. Toque em “Retomar” para continuar.`,
        });
        break;
      case "errors":
        setMessage({
          tone: "error",
          text: `${MAX_CONSECUTIVE_ERRORS} erros seguidos. Varredura pausada — verifique sua conexão e retome mais tarde. Use “Retestar erros” para repetir esses códigos.`,
        });
        break;
      case "stopped":
        setMessage({
          tone: "info",
          text:
            hasStorageFailure()
              ? "Varredura pausada: o navegador não conseguiu salvar o progresso. Os novos resultados permanecem nesta aba. Baixe uma cópia e tente salvar novamente antes de recarregar."
              : pauseReasonRef.current === "hidden"
              ? "Pausado porque o Safari saiu da tela (aba trocada ou tela bloqueada). O progresso foi salvo; toque em “Retomar”."
              : "Varredura pausada. O progresso foi salvo.",
        });
        break;
      case "done":
        toast.success("Todos os candidatos desta configuração foram testados");
        setMessage({ tone: "info", text: "Varredura concluída para esta configuração." });
        break;
    }
    } catch {
      setMessage({ tone: "error", text: "A verificação foi interrompida com segurança. Confira o aviso de armazenamento e tente novamente; nenhum dado salvo foi apagado." });
    } finally {
      setRunning(false); setCurrent(null); setNextAt(0);
      lock.release(); lockRef.current = null;
    }
  }

  function retestErrors() {
    setResults((prev) => {
      const next = { ...prev };
      for (const c of candidates) if (next[c]?.[0] === "x") delete next[c];
      return next;
    });
    setMessage(null);
  }

  const set = <K extends keyof ScannerConfig>(k: K, v: ScannerConfig[K]) =>
    setConfig((c) => ({ ...c, [k]: v }));

  const cooldownSecs = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const nextSecs = nextAt ? Math.max(0, Math.ceil((nextAt - now) / 1000)) : 0;
  const noLength = !meaningMode && config.source === "generated" && !config.len2 && !config.len3;
  const startLabel = cooling
    ? `Aguarde ${cooldownSecs}s (limite de taxa)`
    : stats.tested > 0
      ? `Retomar (${pending} restantes)`
      : `Iniciar varredura (${total})`;

  return (
    <div className={cn("space-y-4", !meaningMode && "lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0")}>
      <div className={meaningMode ? undefined : "lg:col-span-2"}>
        <WarningBanner />
      </div>

      <section className="space-y-3 rounded-lg border bg-card p-3 sm:p-4" aria-label="Configuração">
        <h2 className="font-semibold">Configuração</h2>
        <fieldset disabled={running || blocked} className="space-y-3 disabled:opacity-60">
          {!meaningMode && <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Fonte dos candidatos">
            {(
              [
                ["generated", "Gerar automaticamente"],
                ["catalog", `Selecionados no catálogo (${selected.length})`],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm",
                  config.source === value && "border-primary bg-accent",
                )}
              >
                <input
                  type="radio"
                  name="source"
                  value={value}
                  checked={config.source === value}
                  onChange={() => set("source", value)}
                  className="size-4 accent-primary"
                />
                {label}
              </label>
            ))}
          </div>}

          {!meaningMode && (config.source === "generated" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Comprimento</span>
                <div className="flex gap-2">
                  {(["len2", "len3"] as const).map((k) => (
                    <label
                      key={k}
                      className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={config[k]}
                        onChange={(e) => set(k, e.target.checked)}
                        className="size-4 accent-primary"
                      />
                      {k === "len2" ? "2" : "3"}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="s-charset" className="text-xs text-muted-foreground">
                  Caracteres
                </Label>
                <NativeSelect
                  id="s-charset"
                  value={config.charset}
                  onChange={(e) => set("charset", e.target.value as Charset)}
                >
                  {(Object.keys(CHARSET_LABEL) as Charset[]).map((c) => (
                    <option key={c} value={c}>
                      {CHARSET_LABEL[c]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
          ) : (
            selected.length === 0 && (
              <EmptyState icon={ListChecks} title="Nenhum código selecionado no catálogo">
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onGoCatalog}>
                  Ir para o catálogo
                </Button>
              </EmptyState>
            )
          ))}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="s-speed" className="text-xs text-muted-foreground">
                Velocidade
              </Label>
              <NativeSelect
                id="s-speed"
                value={interval}
                onChange={(e) => set("intervalMs", Number(e.target.value))}
              >
                {INTERVAL_OPTIONS_MS.map((ms) => (
                  <option key={ms} value={ms}>
                    A cada {ms / 1000}s{ms === MIN_INTERVAL_MS ? " (mín.)" : ""}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="s-batch" className="text-xs text-muted-foreground">
                Pausa automática a cada
              </Label>
              <NativeSelect
                id="s-batch"
                value={config.batch}
                onChange={(e) => set("batch", Number(e.target.value))}
              >
                {BATCH_OPTIONS.map((b) => (
                  <option key={b} value={b}>
                    {b} verificações
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="s-awake" className="text-sm font-normal">
              Manter a tela ligada durante a varredura
              {!wakeLockSupported && (
                <span className="block text-xs text-muted-foreground">
                  Não suportado neste navegador — desative o bloqueio automático da tela.
                </span>
              )}
            </Label>
            <Switch
              id="s-awake"
              checked={config.keepAwake}
              onCheckedChange={(v) => set("keepAwake", v)}
            />
          </div>
        </fieldset>
        <p className="text-xs text-muted-foreground">
          No iPhone, o Safari pausa a varredura se você trocar de aba ou bloquear a tela. O progresso
          fica salvo neste aparelho.
        </p>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-3 sm:p-4" aria-label="Progresso">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Progresso</h2>
          <span className="font-mono text-sm" aria-live="polite">
            {stats.tested.toLocaleString("pt-BR")} / {total.toLocaleString("pt-BR")} testados
          </span>
        </div>
        <Progress value={pct} aria-label="Candidatos testados" />
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat value={stats.e} label="Convite existente" className="bg-status-exists-bg text-status-exists" />
          <Stat
            value={stats.n}
            label="Não encontrado (não confirmado)"
            className="bg-status-notfound-bg text-status-notfound"
          />
          <Stat
            value={stats.x}
            label="Erro/limite de taxa"
            className="bg-status-inconclusive-bg text-status-inconclusive"
          />
        </div>
        {pending > 0 && (
          <p className="text-xs text-muted-foreground">
            Restam {pending.toLocaleString("pt-BR")} códigos · tempo estimado sem pausas:{" "}
            {formatDuration(pending * interval)}.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {running ? (
            <Button
              type="button"
              variant="destructive"
              className="h-12 flex-1"
              onClick={() => {
                pauseReasonRef.current = "user";
                stopRef.current = true;
              }}
            >
              <Pause aria-hidden /> Pausar
            </Button>
          ) : (
            <Button
              type="button"
              className="h-12 flex-1"
              disabled={blocked || cooling || pending === 0 || noLength}
              onClick={start}
            >
              <Play aria-hidden /> {startLabel}
            </Button>
          )}
          {!running && stats.x > 0 && (
            <Button type="button" variant="outline" className="h-12" disabled={blocked} onClick={retestErrors}>
              <RotateCcw aria-hidden /> Retestar erros ({stats.x})
            </Button>
          )}
        </div>
        {noLength && <p className="text-sm text-destructive">Escolha ao menos um comprimento.</p>}

        {cooling && !running && (
          <p className="flex items-center gap-2 text-sm" role="status">
            <Hourglass className="size-4" aria-hidden /> Limite de taxa: aguarde {cooldownSecs}s.
          </p>
        )}

        {running && (
          <p className="flex items-center gap-2 text-sm" role="status" aria-live="polite">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {nextSecs > 0
              ? `Próxima consulta em ${nextSecs}s…`
              : current
                ? `Consultando “${current}”…`
                : "Preparando…"}
          </p>
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

      {recent.length > 0 && (
        <section className={cn("space-y-2", !meaningMode && "lg:col-span-2")}>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Últimos resultados</h2>
            <Button type="button" variant="ghost" size="sm" onClick={onGoResults}>
              Ver todos
            </Button>
          </div>
          <ul className="space-y-2 sm:grid sm:grid-cols-2 sm:gap-2 sm:space-y-0 xl:grid-cols-3">
            {recent.map((r) => (
              <li key={r.code + r.checkedAt} className="rounded-lg border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg font-semibold">{r.code}</span>
                  <StatusBadge status={r.status} />
                  {r.status === "not_found" && (
                    <a
                      href={inviteUrl(r.code)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
                      aria-label={`Abrir ${inviteLabel(r.code)} para validar no Discord`}
                    >
                      <ExternalLink className="size-3.5" aria-hidden /> {inviteLabel(r.code)}
                    </a>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            “{STATUS_LABEL.not_found}” é só a ausência de convite ativo — confirme na aba Ajuda.
          </p>
        </section>
      )}
    </div>
  );
}

function Stat({ value, label, className }: { value: number; label: string; className?: string }) {
  return (
    <div className={cn("rounded-md px-1 py-2", className)}>
      <div className="font-mono text-lg font-semibold">{value.toLocaleString("pt-BR")}</div>
      <div className="text-[11px] leading-tight">{label}</div>
    </div>
  );
}
