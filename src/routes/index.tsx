import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CandidatesTab } from "@/components/vanity/CandidatesTab";
import { ConfirmTab } from "@/components/vanity/ConfirmTab";
import { ResultsTab } from "@/components/vanity/ResultsTab";
import { ScannerTab } from "@/components/vanity/ScannerTab";
import { WarningBanner } from "@/components/vanity/shared";
import { DEFAULT_CATALOG, type CatalogEntry } from "@/lib/vanity/catalog";
import { DEFAULT_SCANNER_CONFIG, type ResultsMap, type ScannerConfig } from "@/lib/vanity/scanner";
import { usePersistentState } from "@/lib/vanity/use-persistent-state";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Discord Vanity Finder — scanner de códigos de 2 e 3 caracteres" },
      {
        name: "description",
        content:
          "Varredura sequencial e conservadora de convites do Discord de 2 e 3 caracteres. Não encontrado não significa vanity URL disponível.",
      },
      { property: "og:title", content: "Discord Vanity Finder" },
      {
        property: "og:description",
        content:
          "Scanner honesto de códigos curtos do Discord: convite existente, não encontrado (não confirmado) ou erro. Funciona no Safari do iPhone.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Tab = "scanner" | "resultados" | "catalogo" | "ajuda";

function Index() {
  const [tab, setTab] = useState<Tab>("scanner");
  const [running, setRunning] = useState(false);
  const [entries, setEntries] = usePersistentState<CatalogEntry[]>("dvf:catalog:v1", DEFAULT_CATALOG);
  const [selected, setSelected] = usePersistentState<string[]>("dvf:selected", []);
  const [results, setResults] = usePersistentState<ResultsMap>("dvf:results:v1", {});
  const [config, setConfig] = usePersistentState<ScannerConfig>(
    "dvf:scanner-config:v1",
    DEFAULT_SCANNER_CONFIG,
  );

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-3 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
      <header className="pt-5 pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Discord Vanity Finder</h1>
        <p className="text-sm text-muted-foreground">
          Scanner de convites de 2 e 3 caracteres. Não encontra URLs registráveis — só indica quais
          códigos não têm convite ativo.
        </p>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <div className="sticky top-0 z-20 -mx-3 space-y-2 bg-background/95 px-3 pt-2 pb-2 backdrop-blur">
          <WarningBanner compact />
          <TabsList className="grid h-11 w-full grid-cols-4">
            <TabsTrigger value="scanner" className="h-9 px-1 text-xs sm:text-sm">
              Scanner{running ? " ●" : ""}
            </TabsTrigger>
            <TabsTrigger value="resultados" className="h-9 px-1 text-xs sm:text-sm">
              Resultados
            </TabsTrigger>
            <TabsTrigger value="catalogo" className="h-9 px-1 text-xs sm:text-sm">
              Catálogo
            </TabsTrigger>
            <TabsTrigger value="ajuda" className="h-9 px-1 text-xs sm:text-sm">
              Ajuda
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="scanner" forceMount className="mt-3 data-[state=inactive]:hidden">
          <ScannerTab
            config={config}
            setConfig={setConfig}
            selected={selected}
            results={results}
            setResults={setResults}
            running={running}
            setRunning={setRunning}
            onGoCatalog={() => setTab("catalogo")}
            onGoResults={() => setTab("resultados")}
          />
        </TabsContent>
        <TabsContent value="resultados" forceMount className="mt-3 data-[state=inactive]:hidden">
          <ResultsTab results={results} setResults={setResults} entries={entries} running={running} />
        </TabsContent>
        <TabsContent value="catalogo" forceMount className="mt-3 data-[state=inactive]:hidden">
          <CandidatesTab
            entries={entries}
            setEntries={setEntries}
            selected={selected}
            setSelected={setSelected}
            lastStatus={results}
            onGoVerify={() => {
              setConfig((c) => ({ ...c, source: "catalog" }));
              setTab("scanner");
            }}
          />
        </TabsContent>
        <TabsContent value="ajuda" forceMount className="mt-3 data-[state=inactive]:hidden">
          <ConfirmTab />
        </TabsContent>
      </Tabs>

      <footer className="mt-10 border-t pt-4 text-xs text-muted-foreground">
        Projeto independente, sem afiliação com o Discord. Não usa login, tokens, proxies nem tenta
        contornar CAPTCHA ou limites. Dados salvos apenas neste aparelho.
      </footer>
    </div>
  );
}
