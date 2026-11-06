# DRUG URL — scanners em segundo plano

## 1. Parecer e escopo

**Viável como serviço externo limitado; não como promessa de funcionamento perfeito, contínuo e ilimitado por US$ 0.** Workers Free, Durable Objects SQLite e alarmes oferecem os recursos necessários. Quando uma cota acabar, o serviço deverá parar, mantendo o progresso, em vez de contratar capacidade.

Este plano não altera código, testes, dados ou publicação. Não houve conexão à Cloudflare nem verificação das cotas disponíveis na sua conta. Somente este documento foi preparado.

A interface continuará hospedada no Lovable. O serviço externo terá provisionamento e implantação próprios: **implantar/migrar o aplicativo Lovable para Cloudflare não é suportado aqui**. Não se pressupõe que o ambiente atual já forneça Durable Objects. Este documento descreve a arquitetura externa, não gera infraestrutura de implantação. A aprovação deste plano não autoriza publicar ou conectar serviços automaticamente.

## 2. Estado atual e mudança necessária

- Dois modos separados: combinações, até **47.952 códigos**, e significado, **3.623 sugestões** antes dos filtros.
- Resultados, configurações, catálogo, favoritos e seleção ficam no navegador. A fila depende da página aberta.
- `checkInvite` é o único caminho de consulta; a trava Web Locks/IndexedDB protege abas da mesma origem. O controle atual do servidor é por instância/cliente, não global e durável.
- Permanecem mínimos de 3 segundos, velocidades mais lentas, lotes de 50/100/250, pausa após três erros e interrupção no primeiro 429.

Fechar a página deixará de interromper o trabalho autorizado. **As pausas por lote continuarão existindo:** sem alguém pressionar Retomar, um lote concluído não iniciará outro automaticamente. Retirar essa proteção seria outra alteração, não incluída.

## 3. Arquitetura técnica proposta

```text
DRUG URL no Lovable
  controles, favoritos, CSV, cópia local
             |
  acesso autorizado / comandos idempotentes
             |
API externa: Worker Free
             |
ÚNICO Durable Object SQLite por instalação
  dois jobs + fila lógica compartilhada
  relógio global + bloqueios + cotas
  resultados + histórico mínimo + sincronização
             |
  alarme: no máximo UMA consulta por execução
             |
Discord: GET /api/v10/invites/{code}?with_counts=false
```

- Um ID estável de objeto para toda a instalação; nunca criar um objeto por scanner, usuário ou IP para aumentar vazão.
- Alternância justa entre jobs em execução. Scanner pausado/cancelado não entra na alternância. Intervalo efetivo: maior entre 3 s e as velocidades aplicáveis dos jobs ativos; nenhuma configuração lenta será acelerada pelo outro modo.
- Fila em SQLite, sem Cloudflare Queues, KV, R2, IA ou serviços pagos adicionais. Combinações geradas incrementalmente pelo cursor; não inserir 47 mil candidatos na criação.
- Significado usa o gerador determinístico atual, versão e hash do conjunto congelado. Filtros/configuração tornam-se uma fotografia imutável do job; mudar filtros na tela não muda silenciosamente uma tarefa em andamento.
- Resultados continuam separados por modo/job. Códigos repetidos entre modos não serão automaticamente considerados verificados no outro: preservação do comportamento e da independência.
- O navegador consulta o andamento apenas quando visível; fechar a página não afeta o alarme. Sem temporizadores permanentes, service worker ou notificações obrigatórias.

### Fonte única de verificações

Na atualização futura, `checkInvite` passará a encaminhar consultas ao mesmo coordenador externo, mantendo a entrada pública atual do aplicativo. A chamada direta antiga ao Discord precisará ser desativada na versão integrada. Verificações locais e remotas nunca poderão operar em paralelo fora desse coordenador.

O intervalo global cobre **esta instalação e todos os seus caminhos atualizados**, não outros aplicativos ou tráfego de terceiros. Versões publicadas antigas, prévias antigas ou outras origens com chamadas diretas impedem essa garantia. A ativação exigirá fechar esses caminhos ou impedir sua execução; nada disso será feito agora.

## 4. Persistência e estados

Modelo lógico:

- `coordinator`: próxima consulta permitida, cooldown, bloqueio global, versão/revisão, tentativa em andamento e contadores por dia UTC.
- `jobs`: modo, configuração, versão de candidatos, cursor, lote, erros consecutivos, estado, motivo, totais e datas.
- `results`: chave job+código, HTTP, classificação, data e revisão incremental.
- `attempt`: identificador único, job/código, reserva temporal e estado incerto/concluído.
- `commands/imports`: IDs idempotentes e recibos de migração com tamanho limitado.

Estados: `queued`, `running`, `pausing`, `paused_user`, `paused_batch`, `paused_errors`, `paused_rate_limit`, `paused_quota`, `paused_recovery`, `cancelled`, `completed`.

**Iniciar:** validação, orçamento reservado, configuração congelada e agendamento.
**Pausar:** impede novos envios; consulta já enviada pode terminar e seu resultado será salvo. Mostrar “Pausando” até resolver a tentativa.
**Retomar:** explícito, preserva cursor/resultados; só permitido após cooldown, com cotas e sem tentativa incerta.
**Cancelar:** termina o job e conserva resultados. Não é apagar; continuar depois cria tarefa explícita que pode aproveitar progresso validado.
**Limpar resultados:** operação separada, com confirmação e escopo local/remoto. Nunca apagar para liberar cota automaticamente.

API conceitual: criar job; iniciar/pausar/retomar/cancelar; ler estado dos dois modos em uma resposta; resultados paginados por revisão; importar progresso; exportar; limpar com confirmação. IDs de comandos evitam duplicação após falha de conexão.

## 5. Execução segura e recuperação

1. Serializar todos os caminhos que enviam ao Discord. Durable Objects podem intercalar eventos durante `await`: não basta confiar no ID único. Comandos consultam/alteram estado; só o executor serializado envia.
2. Antes de enviar, verificar estado, bloqueio, cotas e tentativa pendente. Reservar duravelmente a tentativa, consumo e próximo horário, no mínimo `agora + 3000 ms`.
3. Fazer uma única consulta, com timeout de 8 s. Não seguir redirecionamentos para hosts diferentes. Não armazenar corpo com dados de servidor/membros; reter apenas o necessário ao resultado.
4. Salvar classificação e avanço de cursor de forma transacional. Agendar a próxima consulta após conclusão, respeitando também 3 s, velocidades, limites informados pelo Discord e margem de segurança. Não compensar atrasos com rajadas.
5. HTTP 200 = convite existente; 404 = não encontrado, disponibilidade não confirmada; demais respostas = inconclusivo. Avisos continuam em tela e CSV.
6. No **primeiro 429**, persistir bloqueio global e Retry-After (maior valor válido entre cabeçalho/corpo), registrar resultado e parar ambos os modos. Sem alarme de novas consultas, sem retomada automática. Ausência de valor: manter fallback conservador e retomada manual. Limites de bucket conhecidos também podem adiar consultas antes do 429.
7. 403/negação do Discord: bloqueio global até revisão, sem trocar IP, token ou serviço. Três falhas consecutivas e fim de lote continuam pausando o job correspondente.

Alarmes têm entrega **pelo menos uma vez**, um alarme pendente por objeto e novas tentativas em falhas; não oferecem horário exato. Duplicatas relerão a reserva persistida, sem duplicar o resultado nem ultrapassar o ritmo.

**Limite inevitável:** uma queda depois de o Discord receber a consulta e antes de salvar a resposta deixa resultado incerto. Não há transação distribuída com o Discord nem garantia exatamente uma vez. Detectar tentativa pendente e pausar para recuperação manual, sem reenviar automaticamente. Isso também cobre um possível 429 não salvo.

Watchdog conceitual a cada 15 minutos apenas reconcilia alarmes ausentes de jobs `running` sem tentativa incerta. Nunca retoma pausas por lote, erro, quota ou 429. Ao esgotar retries do alarme, mantém progresso e sinaliza recuperação; indisponibilidade/quota pode adiar o próprio diagnóstico.

## 6. US$ 0: cotas e orçamento operacional

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

Proposta inicial conservadora: teto global de **5.000 verificações/dia**, até **40.000 escritas**, **1 milhão de leituras**, **50.000 pedidos Worker/DO** e **500 MB armazenados** no orçamento do aplicativo. São novos limites propostos para aprovação, não limites do código atual. Reservar margem e pausar antes de exceder. Medir linhas reais, índices, alarmes, comandos, retries, importação e exportação; contadores próprios não provam o consumo total da conta.

Uma única instância continuamente ativa por 24 h consome aproximadamente **10,8–11,1 mil GB-s**, próxima dos 13 mil gratuitos; espera de rede entra na duração. Nada de outros objetos ativos ou timers longos. Medir a contabilidade real e reservar margem de duração.

Atualização de estado sugerida a cada 60 s, somente em aba visível, com paginação e uma resposta para ambos os modos. Um cliente aberto 24 h geraria 1.440 pedidos Worker e DO/dia; 100 clientes esgotariam cotas. Uso público irrestrito é incompatível com garantia de serviço gratuito.

CPU dos alarmes DO precisa ser validada: páginas oficiais descrevem 30 s para invocações DO, mas também remetem aos limites do plano; não depender desse orçamento sem esclarecer a aplicação no Free. Projetar execução pequena, testar CPU e interromper ativação se Free não comportar.

Pisos ideais a 3 s, sem latência/pausas: significado **3h01**; letras **15h12**; alfanumérico **39h57**. Com teto de 5.000/dia, exigem respectivamente 1, 4 e 10 janelas diárias; ambos os maiores conjuntos, 51.575 consultas antes de qualquer reaproveitamento, 11. Lotes, erros e cooldown aumentam o tempo real.

US$ 0 refere-se ao serviço externo Free, sem domínio comprado ou add-ons; não garante custo zero de criação no Lovable nem substitui custos atuais. Se a conta já for paga, tiver outros consumos ou a oferta mudar, suspender a proposta e informar, sem habilitar nada pago.

## 7. Segurança e migração não destrutiva

Sem tokens **do Discord**, login Discord, proxies de evasão ou rotação de IP. A API de controle precisa de autorização própria: caso contrário qualquer visitante poderia iniciar/cancelar tarefas e consumir a cota. Primeira versão proposta de acesso privado ao operador, com sessão segura e segredo interno do serviço; nenhum segredo Cloudflare no navegador. Se “sem tokens” também excluir toda credencial interna, essa arquitetura ficará bloqueada até definir proteção compatível. Não abrir endpoint público irrestrito.

Migração explícita, nunca no carregamento da página:
1. Baixar backup atual e manter intactas todas as chaves `dvf:*`, originais e sidecars `:recovery:v1`.
2. Validar ambos os mapas de resultados, configurações, filtros, catálogo e seleção com as regras existentes. Dados incertos ficam recuperáveis; HTTP prevalece na classificação.
3. Copiar somente dados autorizados e necessários ao job em lotes pequenos, limitados por cotas, com hash/recibo idempotente. Não enviar favoritos ou catálogo inteiro por padrão.
4. Importar jobs pausados. Verificar contagem, códigos e configurações antes de oferecer Iniciar. Migrar cooldown pelo maior prazo, sem reduzi-lo.
5. Criar chave local nova e versionada para IDs/revisões remotos; não reaproveitar mapas antigos. Sincronizar incrementalmente sem sobrescrever favoritos, alterações locais ou exclusões deliberadas.
6. Preservar resultados remotos quando o navegador estiver sem espaço; mostrar aviso e manter exportação remota paginada. Não afirmar “salvo neste dispositivo” antes de confirmar.
7. Rollback: pausar serviço remoto, exportar e reconciliar resultados; somente então reativar fila local, sem sobreposição. Nunca apagar originais como etapa de migração.

Recuperar no mesmo dispositivo exige ID/autorização persistidos. Outro dispositivo, limpeza de cookies ou perda da credencial exigem mecanismo seguro de recuperação; o plano não promete contas ou sincronização pessoal inexistentes hoje.

## 8. Arquivos e configurações futuras

Inventário conceitual do serviço separado: `api.ts`, `coordinator.ts`, `scheduler.ts`, `discord-client.ts`, `quota-budget.ts`, `schema.sql`, `migrations/`, `contracts.ts`, `candidate-manifest.ts`, `auth.ts`, testes e documento operacional. Configuração futura deverá declarar Free, binding SQLite DO, migração inicial, ID único, watchdog UTC, origens permitidas, segredos internos, orçamento e retenção. Não há arquivos de implantação gerados neste plano.

No aplicativo: novos `remote-jobs.ts`, `use-remote-jobs.ts`, `remote-migration.ts` e testes; adaptação de `ScannerTab`, `ResultsTab`, `StorageNotice`, `index.tsx`, persistência e `invite-check.functions/server`. Reusar `check-rules`, geradores e classificação, sem modificar as regras existentes. Atualizar `AGENTS.md` somente após aprovação da mudança de dados locais para jobs remotos. Manter layouts, CSV, catálogo, favoritos e 3.623 sugestões.

## 9. Riscos, testes e aprovação

**Bloqueios antes de implementação/ativação:** acesso gratuito real da conta; implantação externa disponível; autorização privada; orçamento medido; revisão das políticas do Discord. O endpoint público Get Invite não é autorização geral para enumeração em massa. Respeitar 3 s não prova conformidade; não lançar a varredura permanente se sua finalidade contrariar os termos.

Testes futuros: dois jobs+abas disputando fila; intervalo de 3.000 ms inclusive em retries/crashes; uma consulta em voo; 429 bloqueando tudo e persistindo após reinício; 404 nunca disponível; pausas por lote/erros; comandos duplicados; cancelar sem apagar; importação repetida/corrompida; quota/CPU/SQLite cheios; alarmes atrasados/repetidos/ausentes; página fechada com progresso remoto e releitura; backup/CSV; regressão das 3.623 sugestões e recursos; Safari real e demais tamanhos.

Não provocar um 429 real nem uma sobrecarga para testar: simulações e medições controladas. Esta análise não executou esses testes nem confirmou uma implantação. Implementar somente após aprovação, por etapas com pontos de parada; conectar, migrar dados e publicar exigirão autorização própria.

### Fontes oficiais
- [Workers: preços](https://developers.cloudflare.com/workers/platform/pricing/) e [limites](https://developers.cloudflare.com/workers/platform/limits/).
- [Durable Objects: preços](https://developers.cloudflare.com/durable-objects/platform/pricing/) e [limites](https://developers.cloudflare.com/durable-objects/platform/limits/).
- [Alarmes](https://developers.cloudflare.com/durable-objects/api/alarms/) e [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
- [Discord: Get Invite](https://docs.discord.com/developers/resources/invite), [rate limits](https://docs.discord.com/developers/topics/rate-limits), [Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy) e [termos](https://discord.com/terms/).