import { Download, History, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

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
import { downloadCsv, inviteLabel } from "@/lib/vanity/browser";
import type { CatalogEntry } from "@/lib/vanity/catalog";
import { STATUS_LABEL, toCsv, type CheckStatus } from "@/lib/vanity/check-rules";

import { EmptyState, NOT_FOUND_WARNING, StatusBadge, WarningBanner, type HistoryItem } from "./shared";

interface Props {
  history: HistoryItem[];
  setHistory: React.Dispatch<React.SetStateAction<HistoryItem[]>>;
  entries: CatalogEntry[];
}

const FILTERS: Array<{ value: "all" | CheckStatus; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "exists", label: STATUS_LABEL.exists },
  { value: "not_found", label: STATUS_LABEL.not_found },
  { value: "inconclusive", label: STATUS_LABEL.inconclusive },
];

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });

export function HistoryTab({ history, setHistory, entries }: Props) {
  const [filter, setFilter] = useState<"all" | CheckStatus>("all");
  const [confirmClear, setConfirmClear] = useState(false);
  const meanings = useMemo(() => new Map(entries.map((e) => [e.code, e.meaning])), [entries]);
  const list = filter === "all" ? history : history.filter((h) => h.status === filter);

  function exportCsv() {
    downloadCsv(
      "vanity-historico.csv",
      toCsv(
        ["codigo", "link", "significado", "status", "http", "motivo", "verificado_em", "aviso"],
        list.map((h) => [
          h.code,
          inviteLabel(h.code),
          meanings.get(h.code) ?? "",
          STATUS_LABEL[h.status],
          h.httpStatus ?? "",
          h.reason,
          h.checkedAt,
          h.status === "not_found" ? NOT_FOUND_WARNING : "",
        ]),
      ),
    );
  }

  return (
    <div className="space-y-4">
      <WarningBanner compact />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por status">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            type="button"
            size="sm"
            variant={filter === f.value ? "default" : "outline"}
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
            className="h-9"
          >
            {f.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={exportCsv} disabled={list.length === 0} className="h-10">
          <Download aria-hidden /> Exportar CSV
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setConfirmClear(true)}
          disabled={history.length === 0}
          className="h-10 text-destructive hover:text-destructive"
        >
          <Trash2 aria-hidden /> Limpar histórico
        </Button>
      </div>

      {history.length === 0 ? (
        <EmptyState icon={History} title="Nenhuma verificação ainda">
          Os resultados ficam salvos apenas neste aparelho.
        </EmptyState>
      ) : list.length === 0 ? (
        <EmptyState icon={History} title="Nenhum resultado com este status" />
      ) : (
        <ul className="space-y-2">
          {list.map((h) => (
            <li key={h.id} className="rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-lg font-semibold">{h.code}</span>
                <StatusBadge status={h.status} />
                <span className="ml-auto text-xs text-muted-foreground">{fmt(h.checkedAt)}</span>
              </div>
              {meanings.get(h.code) && <p className="mt-1 text-sm">{meanings.get(h.code)}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                {h.httpStatus != null ? `HTTP ${h.httpStatus} · ` : ""}
                {h.reason}
              </p>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Limpar todo o histórico?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso apaga os resultados salvos neste aparelho. Não pode ser desfeito.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => setHistory([])}>Limpar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
