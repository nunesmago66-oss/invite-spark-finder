# DRUG URL — scanners em segundo plano

## 1. Parecer e escopo
**Viável como serviço externo limitado, não como execução perfeita, ininterrupta e ilimitada por US$ 0.** Ao atingir cotas, parar e preservar progresso, sem contratar capacidade.

A interface permanece no Lovable. O serviço requer provisionamento/implantação externos; implantar ou migrar o aplicativo Lovable para Cloudflare não é suportado aqui. Não presumir Durable Objects no ambiente atual. Nada foi conectado, implementado, migrado ou publicado; somente este plano foi escrito. Aprovação não autoriza publicação automática.

## 2. Situação atual e arquitetura técnica
Até **47.952 combinações** e **3.623 sugestões** antes dos filtros. Dados locais; fila depende da página. Web Locks/IndexedDB protegem abas da mesma origem, não execução global durável.

```text
DRUG URL no Lovable → API Worker Free autorizada
 → ÚNICO Durable Object SQLite da instalação
 → dois jobs, fila/relógio/cotas/resultados compartilhados
 → alarme: UMA consulta → Discord GET Invite
```

Um ID estável para todos os caminhos, nunca por usuário/scanner/IP para ampliar vazão. Fila SQLite sem Queues/KV/R2/IA pagos. Alternância justa; intervalo = maior entre 3 s e velocidades aplicáveis, sem acelerar configuração lenta.

Combinações incrementais por cursor, sem inserir 47 mil linhas. Significado reutiliza gerador determinístico com versão/hash e filtros congelados. Resultados independentes: não reaproveitar silenciosamente verificações entre modos. Andamento consultado apenas com página visível; sem service worker/timers permanentes.

`checkInvite` deverá encaminhar ao coordenador e deixar de consultar diretamente. Trava local permanece. Versões/prévias antigas com chamadas diretas precisam ser impedidas antes da ativação. Global cobre a instalação atualizada, não terceiros.

Preservar lotes 50/100/250, três erros, velocidades e recursos. **Pausa por lote continua exigindo Retomar**, mesmo com site fechado: não remover proteção para prometer execução contínua.

## 3. Dados e controles
SQLite: coordinator (timing/cooldown/cotas); jobs (modo/config/cursor/lote/erros/estado); results (job+código/HTTP/status/data/revisão); attempt (reserva/resultado incerto); commands/imports (IDs idempotentes/recibos).

Estados: queued/running/pausing; pausado por usuário/lote/erro/429/cota/recuperação; cancelled/completed. Iniciar valida/reserva/agenda; pausar impede novos envios e salva consulta em voo; retomar explícito exige cooldown/cotas; **cancelar conserva resultados**, continuar exige novo job explícito. Limpar é separado, confirmado, com escopo local/remoto.

API: criação/comandos idempotentes; estado dos dois modos numa resposta; resultados por revisão/página; importar/exportar/limpar. Um job por modo; filtros/configuração imutáveis durante execução.

## 4. Executor, 429 e recuperação
1. Serializar todos os envios. Eventos DO podem intercalar durante `await`: ID único não basta. Comandos alteram estado; somente executor serializado consulta.
2. Verificar estado/cotas/bloqueio/tentativa pendente. Persistir reserva e próximo horário ≥ agora+3.000 ms **antes** do envio; no máximo uma consulta por alarme.
3. GET Discord atual, timeout 8 s; não seguir redirecionamento a outro host nem guardar corpo com dados de servidores/membros.
4. Salvar resultado+cursor transacionalmente. Próximo envio após conclusão e ≥3 s, respeitando velocidade e limites Discord, sem rajadas de compensação.
5. 200=existente; **404=não encontrado, disponibilidade não confirmada**; demais=inconclusivo. Aviso permanente e CSV preservados.
6. **Primeiro 429 bloqueia ambos os modos**, salva resultado/cooldown pelo maior Retry-After válido de cabeçalho/corpo e remove agenda de consultas. Fallback conservador se ausente. Retomada manual, nunca automática; considerar limites de bucket antes do 429.
7. 403/negação bloqueia tudo até revisão, sem mudar IP/serviço/token. Três erros consecutivos e lotes continuam pausando o job correspondente.

Alarmes: pelo menos uma entrega, um pendente por objeto, retries exponenciais até seis. Duplicatas relerão reservas/estado, sem duplicar avanço ou furar ritmo. Não há pontualidade garantida.

**Queda após envio e antes de salvar deixa resultado incerto**, inclusive possível 429. Não existe exatamente uma vez para HTTP externo. Detectar tentativa pendente e pausar para recuperação manual; não reenviar automaticamente.

Watchdog de 15 min apenas repara alarme ausente de job running sem tentativa incerta; nunca retoma pausas. Após retries esgotados, manter progresso e sinalizar recuperação. Quota/indisponibilidade pode atrasar o próprio diagnóstico.

## 5. US$ 0: cotas e orçamento operacional

Documentação pública consultada em **06/11/2026**; confirmar novamente antes de qualquer ativação. Cotas são compartilhadas com outros usos da conta.

| Recurso gratuito | Limite publicado |
|---|---:|
| Worker: requisições recebidas | 100.000/dia |
| Worker comum: CPU | 10 ms por execução |
| Durable Object: requisições, incluindo alarmes | 100.000/dia |
| Durable Object: duração | 13.000 GB-s/dia |
| SQLite: linhas lidas / escritas | 5 milhões / 100.000 por dia |
| SQLite: armazenamento | 5 GB por conta |

Free aceita objetos **SQLite**, não o armazenamento KV legado. Cotas diárias reiniciam à meia-noite UTC; armazenamento não reinicia. Exceder Free causa falhas, não compra automática de excedente. Plano Paid, mesmo com pouco uso, não atende ao orçamento: não ativar.

**3 s não é uma meta de vazão:** seriam até 28.800 consultas/alarmes por dia. Cada `setAlarm` conta como escrita. Alarme mais três outras linhas escritas por consulta daria **115.200 escritas/dia**, acima da cota, antes de índices, importações e controles.

**Tetos novos propostos para aprovação:** 5.000 consultas/dia; orçamento do aplicativo: 40.000 escritas, 1 milhão leituras, 50.000 pedidos Worker/DO e 500 MB retidos. Não são limites atuais. Reservar margem e medir índices/alarmes/retries/comandos/importação; parar antes de exceder, nunca apagar automaticamente. Contadores próprios não cobrem outros usos da conta.

Um DO ativo 24 h ≈10,8–11,1 mil GB-s, perto de 13 mil; espera de rede conta. Evitar outros objetos/timers. CPU DO: documentação menciona 30 s mas remete ao plano; testar Free e não depender de orçamento maior sem esclarecimento.

Polling 60 s só em aba visível: cliente 24 h=1.440 pedidos Worker+DO; 100 clientes esgotariam cotas. Uso público irrestrito não garante operação gratuita.

Pisos a 3 s sem pausas: significado 3h01; letras 15h12; alfanumérico 39h57. A 5.000/dia: 1/4/10 janelas diárias; ambos maiores conjuntos (51.575), 11. Lotes/erros aumentam duração.

US$ 0 cobre externo Free sem domínio/add-ons, não criação Lovable/custos atuais. Conta paga/outros consumos/mudança de oferta bloqueiam ativação; não habilitar upgrades.

## 6. Segurança e migração não destrutiva
Sem tokens **Discord**, proxies de evasão, rotação de IP ou login Discord. API de controle precisa de autorização própria para impedir abuso da quota/cancelamentos. Proposta inicial: operador privado, sessão segura e segredo interno; nunca segredo Cloudflare no navegador. Se “sem tokens” também excluir credenciais internas, bloquear até definir proteção compatível. Nada público irrestrito.

1. Migração explícita, não no carregamento. Baixar backup, manter todas as chaves `dvf:*`, originais e sidecars `:recovery:v1`.
2. Validar mapas/configurações/filtros com regras existentes; HTTP prevalece. Preservar catálogo/favoritos/seleção locais, sem upload por padrão.
3. Copiar somente dados autorizados em lotes com hash/recibo idempotente e cotas reservadas. Importar jobs pausados; comparar códigos/contagem/configuração antes de Iniciar; cooldown pelo maior prazo.
4. Nova chave local versionada para IDs/revisões remotos, sem repurpose de mapas antigos. Merge incremental sem sobrescrever favoritos, edições ou exclusões deliberadas.
5. Sem espaço local: conservar remoto, mostrar aviso/exportação paginada; não afirmar salvamento local antes de confirmar.
6. Rollback: pausar remoto, exportar/reconciliar e só então reativar fila local; sem sobreposição/apagar originais.

Recuperação no mesmo dispositivo depende de ID/autorização persistidos; outro dispositivo ou cookies apagados requer recuperação segura, não contas/sincronização pessoal prometidas implicitamente.

## 7. Arquivos e configurações futuras
Serviço separado, inventário conceitual: `api.ts`, `coordinator.ts`, `scheduler.ts`, `discord-client.ts`, `quota-budget.ts`, `schema.sql`, `migrations/`, `contracts.ts`, `candidate-manifest.ts`, `auth.ts`, testes e manual operacional. Configuração: Free, binding DO SQLite, migração inicial, ID único, watchdog UTC, origens/autorização, orçamento e retenção. **Nenhum arquivo de implantação gerado agora.**

Aplicativo: novos `remote-jobs.ts`, `use-remote-jobs.ts`, `remote-migration.ts` e testes; adaptação de ScannerTab, ResultsTab, StorageNotice, index, persistência e invite-check.functions/server. Reusar geradores e check-rules sem alterar regras. Atualizar AGENTS somente após aprovação da mudança de dados locais. Preservar layouts e demais recursos.

## 8. Bloqueios e validação futura
Antes de ativar: Free/cotas reais da conta, implantação externa disponível, autorização privada, consumo medido e revisão das políticas Discord. Get Invite público não autoriza automaticamente enumeração em massa; 3 s não prova conformidade. Não lançar varredura permanente contrária aos termos.

Testar: dois jobs+abas; ≥3.000 ms inclusive retries/crashes; uma consulta em voo; 429 global persistente sem auto-retomar; 404 honesto; lotes/erros; cancelar sem apagar; comandos/importações duplicados/corrompidos; quota/CPU/SQLite; alarmes repetidos/atrasados/ausentes; site fechado e releitura; backup/CSV; regressão de 3.623 sugestões e todos os recursos; Safari real e telas diversas.

Simular 429/falhas, sem sobrecarregar Discord. **Nenhum desses testes remotos foi executado nesta análise.** Implementar por etapas somente após aprovação; conexão, migração e publicação continuam dependendo de autorização.

### Fontes oficiais
- [Workers: preços](https://developers.cloudflare.com/workers/platform/pricing/) e [limites](https://developers.cloudflare.com/workers/platform/limits/).
- [Durable Objects: preços](https://developers.cloudflare.com/durable-objects/platform/pricing/) e [limites](https://developers.cloudflare.com/durable-objects/platform/limits/).
- [Alarmes](https://developers.cloudflare.com/durable-objects/api/alarms/) e [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
- [Discord: Get Invite](https://docs.discord.com/developers/resources/invite), [rate limits](https://docs.discord.com/developers/topics/rate-limits), [Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy) e [termos](https://discord.com/terms/).