import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CandidatesTab } from "@/components/vanity/CandidatesTab";
import { ConfirmTab } from "@/components/vanity/ConfirmTab";
import { ResultsTab } from "@/components/vanity/ResultsTab";
import { ScannerTab } from "@/components/vanity/ScannerTab";
import { DEFAULT_MEANING_FILTERS, MeaningSuggestions, filterMeaningCandidates, type MeaningFilters } from "@/components/vanity/MeaningSuggestions";
import { generateMeaningCandidates } from "@/lib/vanity/meaning-generator";
import { WarningBanner } from "@/components/vanity/shared";
import { DEFAULT_CATALOG, type CatalogEntry } from "@/lib/vanity/catalog";
import { DEFAULT_SCANNER_CONFIG, type ResultsMap, type ScannerConfig } from "@/lib/vanity/scanner";
import { usePersistentState } from "@/lib/vanity/use-persistent-state";
import { StorageNotice } from "@/components/vanity/StorageNotice";

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
  const [meaningRunning, setMeaningRunning] = useState(false);
  const [mode, setMode] = useState("all");
  const [resultMode, setResultMode] = useState("all");
  const [meaningResults, setMeaningResults] = usePersistentState<ResultsMap>("dvf:meaning-results:v1", {});
  const [meaningConfig, setMeaningConfig] = usePersistentState<ScannerConfig>("dvf:meaning-config:v1", DEFAULT_SCANNER_CONFIG);
  const [meaningFilters, setMeaningFilters] = usePersistentState<MeaningFilters>("dvf:meaning-filters:v1", DEFAULT_MEANING_FILTERS);
  const [cooldownUntil, setCooldownUntil] = usePersistentState("dvf:cooldown-until", 0);
  const [lastCheckAt, setLastCheckAt] = usePersistentState("dvf:last-check-at", 0);
  const meaningPool = useMemo(generateMeaningCandidates, []);
  const meaningCodes = useMemo(() => filterMeaningCandidates(meaningPool, meaningFilters).slice(0, meaningFilters.limit).map(c => c.code), [meaningPool, meaningFilters]);
  const timing = { cooldownUntil, setCooldownUntil, lastCheckAt, setLastCheckAt };
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
          <StorageNotice />
          <TabsList className="grid h-11 w-full grid-cols-4">
            <TabsTrigger value="scanner" className="h-9 px-1 text-xs sm:text-sm">
              Scanner{running || meaningRunning ? " ●" : ""}
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
          <Tabs value={mode} onValueChange={setMode}>
            <TabsList className="grid h-auto w-full grid-cols-2 mb-4">
              <TabsTrigger value="all" className="min-h-11 whitespace-normal text-xs">Todas as combinações{running ? " ●" : ""}</TabsTrigger>
              <TabsTrigger value="meaning" className="min-h-11 whitespace-normal text-xs">URLs com significado{meaningRunning ? " ●" : ""}</TabsTrigger>
            </TabsList>
            <TabsContent value="all" forceMount className="data-[state=inactive]:hidden">
          <ScannerTab
            {...timing}
            blocked={meaningRunning}
            config={config}
            setConfig={setConfig}
            selected={selected}
            results={results}
            setResults={setResults}
            running={running}
            setRunning={setRunning}
            onGoCatalog={() => setTab("catalogo")}
            onGoResults={() => { setResultMode("all"); setTab("resultados"); }}
          />
            </TabsContent>
            <TabsContent value="meaning" forceMount className="space-y-4 data-[state=inactive]:hidden">
              <MeaningSuggestions all={meaningPool} filters={meaningFilters} setFilters={setMeaningFilters} running={running || meaningRunning} />
              <ScannerTab {...timing} meaningMode candidateCodes={meaningCodes} blocked={running} config={meaningConfig} setConfig={setMeaningConfig} selected={[]} results={meaningResults} setResults={setMeaningResults} running={meaningRunning} setRunning={setMeaningRunning} onGoCatalog={() => setTab("catalogo")} onGoResults={() => { setResultMode("meaning"); setTab("resultados"); }} />
            </TabsContent>
          </Tabs>
        </TabsContent>
        <TabsContent value="resultados" forceMount className="mt-3 data-[state=inactive]:hidden">
          <Tabs value={resultMode} onValueChange={setResultMode}>
            <TabsList className="grid w-full grid-cols-2 mb-3"><TabsTrigger value="all" className="text-xs">Todas as combinações</TabsTrigger><TabsTrigger value="meaning" className="text-xs">URLs com significado</TabsTrigger></TabsList>
            <TabsContent value="all" forceMount className="data-[state=inactive]:hidden"><ResultsTab results={results} setResults={setResults} entries={entries} running={running} /></TabsContent>
            <TabsContent value="meaning" forceMount className="data-[state=inactive]:hidden"><ResultsTab results={meaningResults} setResults={setMeaningResults} entries={meaningPool} running={meaningRunning} /></TabsContent>
          </Tabs>
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
              setMode("all");
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
