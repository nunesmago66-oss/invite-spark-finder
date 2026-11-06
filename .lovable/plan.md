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

## 6. Segurança e migração
Sem token/login Discord, proxy de evasão ou rotação de IP. Controle requer autorização própria contra abuso: operador privado, sessão segura/segredo interno, nunca segredo Cloudflare no navegador. Se “sem tokens” excluir credenciais internas também, bloquear até definir proteção compatível.

Migração explícita: backup; preservar todas as chaves dvf:* e sidecars :recovery:v1; validar mapas/config/filtros com regras atuais; HTTP prevalece. Catálogo/favoritos/seleção ficam locais, sem upload padrão. Copiar só dados autorizados, por lotes com recibo/hash/cota; importar pausado, conferir códigos/contagens/config e cooldown pelo maior prazo. Nova chave local versionada para IDs/revisões; merge sem sobrescrever edições/exclusões/originais.

Sem espaço local, manter remoto e oferecer aviso/exportação paginada; confirmar antes de afirmar salvamento local. Rollback: pausar remoto, exportar/reconciliar, então reativar local sem sobreposição. Não apagar dados. Recuperação depende de ID/autorização; cookies apagados/outro dispositivo exigem recuperação segura, não contas implícitas.

## 7. Arquivos e configuração futura
Serviço separado: api, coordinator, scheduler, discord-client, quota-budget, contracts, candidate-manifest e auth (`.ts`); schema.sql/migrations; testes/manual. Configuração: Free, DO SQLite/migração inicial, ID único, watchdog UTC, origens/autorização, orçamento/retenção. Nenhuma infraestrutura de implantação gerada agora.

App: remote-jobs.ts, use-remote-jobs.ts, remote-migration.ts/testes; adaptar ScannerTab, ResultsTab, StorageNotice, index, persistência e invite-check.functions/server. Reusar geradores/check-rules. Atualizar AGENTS após aprovação da mudança estrutural.

## 8. Bloqueios e testes futuros
Exigir Free/cotas reais, implantação externa, autorização privada, consumo medido e revisão das políticas Discord. Get Invite público não autoriza automaticamente enumeração; 3 s não prova conformidade. Não lançar uso contrário aos termos.

Testar jobs+abas/intervalo ≥3.000 ms; retries/crashes; uma consulta em voo; 429 global persistente/manual; 404 honesto; lotes/erros; cancelar sem apagar; comandos/importações duplicados/corrompidos; quotas/CPU/SQLite; alarmes atrasados/repetidos/ausentes; site fechado/releitura; backup/CSV; 3.623 sugestões/demais recursos; Safari real/telas diversas. Simular falhas sem sobrecarregar Discord.

**Testes remotos não executados nesta análise.** Implementação por etapas após aprovação; conexão/migração/publicação continuam exigindo autorização.

### Fontes oficiais
- [Workers: preços](https://developers.cloudflare.com/workers/platform/pricing/) e [limites](https://developers.cloudflare.com/workers/platform/limits/).
- [Durable Objects: preços](https://developers.cloudflare.com/durable-objects/platform/pricing/) e [limites](https://developers.cloudflare.com/durable-objects/platform/limits/).
- [Alarmes](https://developers.cloudflare.com/durable-objects/api/alarms/) e [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
- [Discord: Get Invite](https://docs.discord.com/developers/resources/invite), [rate limits](https://docs.discord.com/developers/topics/rate-limits), [Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy) e [termos](https://discord.com/terms/).