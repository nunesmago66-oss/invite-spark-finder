import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CandidatesTab } from "@/components/vanity/CandidatesTab";
import { ConfirmTab } from "@/components/vanity/ConfirmTab";
import { HistoryTab } from "@/components/vanity/HistoryTab";
import { VerifyTab } from "@/components/vanity/VerifyTab";
import { WarningBanner, type HistoryItem } from "@/components/vanity/shared";
import { DEFAULT_CATALOG, type CatalogEntry } from "@/lib/vanity/catalog";
import type { CheckResult } from "@/lib/vanity/check-rules";
import { usePersistentState } from "@/lib/vanity/use-persistent-state";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Discord Vanity Finder — códigos curtos de 2 e 3 caracteres" },
      {
        name: "description",
        content:
          "Organize e avalie códigos curtos de convite do Discord com significado. Verificação pública honesta: não encontrado não significa disponível.",
      },
      { property: "og:title", content: "Discord Vanity Finder" },
      {
        property: "og:description",
        content:
          "Catálogo de códigos de 2 e 3 caracteres com significado, favoritos, verificação pública de convites e exportação CSV.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const HISTORY_MAX = 500;
type Tab = "candidatos" | "verificar" | "historico" | "confirmar";

function Index() {
  const [tab, setTab] = useState<Tab>("candidatos");
  const [entries, setEntries] = usePersistentState<CatalogEntry[]>("dvf:catalog:v1", DEFAULT_CATALOG);
  const [selected, setSelected] = usePersistentState<string[]>("dvf:selected", []);
  const [history, setHistory] = usePersistentState<HistoryItem[]>("dvf:history", []);

  const lastStatus = useMemo(() => {
    const map: Record<string, CheckResult> = {};
    for (const h of history) if (!map[h.code]) map[h.code] = h;
    return map;
  }, [history]);

  const addResult = (r: CheckResult) =>
    setHistory((h) =>
      [{ ...r, id: `${r.code}-${r.checkedAt}-${Math.random().toString(36).slice(2, 7)}` }, ...h].slice(
        0,
        HISTORY_MAX,
      ),
    );

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-3 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
      <header className="pt-5 pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Discord Vanity Finder</h1>
        <p className="text-sm text-muted-foreground">
          Organize códigos curtos de 2 e 3 caracteres com significado.
        </p>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <div className="sticky top-0 z-20 -mx-3 space-y-2 bg-background/95 px-3 pt-2 pb-2 backdrop-blur">
          <WarningBanner compact />
          <TabsList className="grid h-11 w-full grid-cols-4">
            <TabsTrigger value="candidatos" className="h-9 px-1 text-xs sm:text-sm">
              Candidatos
            </TabsTrigger>
            <TabsTrigger value="verificar" className="h-9 px-1 text-xs sm:text-sm">
              Verificar{selected.length > 0 ? ` (${selected.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="historico" className="h-9 px-1 text-xs sm:text-sm">
              Histórico
            </TabsTrigger>
            <TabsTrigger value="confirmar" className="h-9 px-1 text-xs sm:text-sm">
              Confirmar
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="candidatos" forceMount className="mt-3 data-[state=inactive]:hidden">
          <CandidatesTab
            entries={entries}
            setEntries={setEntries}
            selected={selected}
            setSelected={setSelected}
            lastStatus={lastStatus}
            onGoVerify={() => setTab("verificar")}
          />
        </TabsContent>
        <TabsContent value="verificar" forceMount className="mt-3 data-[state=inactive]:hidden">
          <VerifyTab
            selected={selected}
            setSelected={setSelected}
            onResult={addResult}
            onGoCandidates={() => setTab("candidatos")}
            onGoConfirm={() => setTab("confirmar")}
          />
        </TabsContent>
        <TabsContent value="historico" forceMount className="mt-3 data-[state=inactive]:hidden">
          <HistoryTab history={history} setHistory={setHistory} entries={entries} />
        </TabsContent>
        <TabsContent value="confirmar" forceMount className="mt-3 data-[state=inactive]:hidden">
          <ConfirmTab />
        </TabsContent>
      </Tabs>

      <footer className="mt-10 border-t pt-4 text-xs text-muted-foreground">
        Projeto independente, sem afiliação com o Discord. Não pede login, não usa tokens e salva
        dados apenas neste aparelho.
      </footer>
    </div>
  );
}
