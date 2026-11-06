import { Copy, Download, ExternalLink, History, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copyText, downloadCsv, inviteLabel, inviteUrl } from "@/lib/vanity/browser";
import type { CatalogEntry } from "@/lib/vanity/catalog";
import { STATUS_LABEL, toCsv } from "@/lib/vanity/check-rules";
import {
  describeResult,
  statusLabelOf,
  statusOf,
  type ResultsMap,
  type StatusKey,
} from "@/lib/vanity/scanner";

import { EmptyState, NOT_FOUND_WARNING, NativeSelect, StatusBadge, WarningBanner } from "./shared";

interface Props {
  results: ResultsMap;
  setResults: React.Dispatch<React.SetStateAction<ResultsMap>>;
  entries: CatalogEntry[];
  running: boolean;
}

const FILTERS: Array<{ value: "all" | StatusKey; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "e", label: STATUS_LABEL.exists },
  { value: "n", label: "Não encontrado" },
  { value: "x", label: STATUS_LABEL.inconclusive },
];

const PAGE = 100;
const fmt = (sec: number) =>
  new Date(sec * 1000).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function ResultsTab({ results, setResults, entries, running }: Props) {
  const [filter, setFilter] = useState<"all" | StatusKey>("all");
  const [length, setLength] = useState<"all" | "2" | "3">("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [confirmClear, setConfirmClear] = useState(false);
  const meanings = useMemo(() => new Map(entries.map((e) => [e.code, e.meaning])), [entries]);

  const all = useMemo(
    () => Object.entries(results).sort((a, b) => b[1][2] - a[1][2] || a[0].localeCompare(b[0])),
    [results],
  );
  const counts = useMemo(() => {
    const c = { e: 0, n: 0, x: 0 };
    for (const [, r] of all) c[r[0]]++;
    return c;
  }, [all]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(([code, r]) => {
      if (filter !== "all" && r[0] !== filter) return false;
      if (length !== "all" && code.length !== Number(length)) return false;
      if (q && !code.includes(q) && !(meanings.get(code) ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, filter, length, query, meanings]);

  function exportCsv() {
    downloadCsv(
      "vanity-resultados.csv",
      toCsv(
        ["codigo", "link", "comprimento", "status", "http", "verificado_em", "significado", "aviso"],
        list.map(([code, r]) => [
          code,
          inviteLabel(code),
          code.length,
          statusLabelOf(r),
          r[1] ?? "",
          new Date(r[2] * 1000).toISOString(),
          meanings.get(code) ?? "",
          r[0] === "n" ? NOT_FOUND_WARNING : "",
        ]),
      ),
    );
  }

  async function copy(code: string) {
    const ok = await copyText(inviteLabel(code));
    if (ok) toast.success(`Copiado: ${inviteLabel(code)}`);
    else toast.error("Não foi possível copiar.");
  }

  return (
    <div className="space-y-4">
      <WarningBanner compact />

      <p className="text-sm">
        <strong className="font-mono">{all.length.toLocaleString("pt-BR")}</strong> códigos
        testados · {counts.e} existentes · {counts.n} não encontrados · {counts.x} erros
      </p>

      <section className="space-y-3 rounded-lg border bg-card p-3" aria-label="Filtros">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por status">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              type="button"
              size="sm"
              variant={filter === f.value ? "default" : "outline"}
              aria-pressed={filter === f.value}
              onClick={() => {
                setFilter(f.value);
                setLimit(PAGE);
              }}
              className="h-9"
            >
              {f.label}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="Buscar código"
              aria-label="Buscar código ou significado"
              autoCapitalize="none"
              autoCorrect="off"
              className="h-10 pl-9"
            />
          </div>
          <div>
            <Label htmlFor="r-length" className="sr-only">
              Comprimento
            </Label>
            <NativeSelect
              id="r-length"
              value={length}
              onChange={(e) => {
                setLength(e.target.value as typeof length);
                setLimit(PAGE);
              }}
            >
              <option value="all">Todos</option>
              <option value="2">2 letras</option>
              <option value="3">3 letras</option>
            </NativeSelect>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={exportCsv} disabled={list.length === 0} className="h-10">
          <Download aria-hidden /> Exportar CSV ({list.length.toLocaleString("pt-BR")})
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setConfirmClear(true)}
          disabled={all.length === 0 || running}
          className="h-10 text-destructive hover:text-destructive"
        >
          <Trash2 aria-hidden /> Apagar resultados
        </Button>
      </div>

      {all.length === 0 ? (
        <EmptyState icon={History} title="Nenhum código testado ainda">
          Inicie uma varredura na aba Scanner. Os resultados ficam salvos só neste aparelho.
        </EmptyState>
      ) : list.length === 0 ? (
        <EmptyState icon={Search} title="Nenhum resultado com esses filtros" />
      ) : (
        <>
          <ul className="space-y-2">
            {list.slice(0, limit).map(([code, r]) => (
              <li key={code} className="rounded-lg border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg font-semibold">{code}</span>
                  <StatusBadge status={statusOf(r)} />
                  <span className="ml-auto text-xs text-muted-foreground">{fmt(r[2])}</span>
                </div>
                {meanings.get(code) && <p className="mt-1 text-sm">{meanings.get(code)}</p>}
                <p className="mt-1 text-xs text-muted-foreground">{describeResult(r)}</p>
                {r[0] === "n" && (
                  <div className="mt-2 flex flex-wrap gap-2 border-t pt-2">
                    <Button asChild size="sm" variant="outline" className="h-9">
                      <a href={inviteUrl(code)} target="_blank" rel="noopener noreferrer">
                        <ExternalLink aria-hidden /> Validar {inviteLabel(code)}
                      </a>
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-9"
                      aria-label={`Copiar ${inviteLabel(code)}`}
                      onClick={() => copy(code)}
                    >
                      <Copy aria-hidden />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {list.length > limit && (
            <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setLimit((l) => l + PAGE)}>
              Mostrar mais ({(list.length - limit).toLocaleString("pt-BR")} restantes)
            </Button>
          )}
        </>
      )}

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar todos os resultados?</AlertDialogTitle>
            <AlertDialogDescription>
              O progresso da varredura volta a zero neste aparelho. Não pode ser desfeito.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => setResults({})}>Apagar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
