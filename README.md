# Remix of Remix of Remix of Remix of Remix of Discord Url

Crie e implemente um aplicativo web PUBLICÁVEL, responsivo e totalmente utilizável em Safari no iPhone, em português do Brasil, chamado "Discord Vanity Finder". Prioridade absoluta: funcionalidade real, não apenas mockup.

OBJETIVO E LIMITES IMPORTANTES:
O app ajuda a organizar e avaliar códigos curtos de convites/vanity do Discord de 2 e 3 caracteres, com significados. Não afirme que um código está "disponível para registrar" apenas porque o endpoint público de convites retorna 404. A API pública de resolução de convite só permite classificar "convite existente", "não encontrado" ou "inconclusivo"; ela NÃO confirma elegibilidade/disponibilidade de vanity URL. A confirmação de vanity URL deve ser feita nas configurações oficiais de um servidor elegível, com permissão apropriada. Seja explícito sobre essa limitação em toda a UI.

FUNCIONALIDADES:
1. Interface mobile-first, acessível e leve, funciona em iPhone Safari sem instalação.
2. Aba "Candidatos": catálogo curado de códigos de 2 e 3 caracteres com significado/expansão e categoria (luxo, riqueza, status, poder, gaming, abreviações, inglês). Incluir exemplos como gg=Good Game, vip=Very Important Person, lux=Luxury, ace=excelência/ás, roy=Royal, lv=Love (abreviação), gm=Good Morning, gn=Good Night, wp=Well Played, op=Overpowered, pro=Professional, zen=calma/equilíbrio, neo=novo, win=vitória, top=topo. Nunca inventar significado: marque como "sigla/abreviação" quando for interpretação contextual e permita editar/adicionar significado personalizado.
3. Filtros por comprimento (2, 3), categoria, busca por código ou significado, ordenação alfabética e favoritos.
4. Adicionar códigos manualmente, remover, copiar discord.gg/CODIGO e abrir convite em nova aba.
5. "Verificar convite": usar uma função server-side/edge function (não chamada direta do navegador se CORS bloquear) para consultar endpoint oficial público GET https://discord.com/api/v10/invites/{code}?with_counts=false. Retornar apenas estados: "convite existente" (HTTP 200), "não encontrado" (HTTP 404), "inconclusivo" (429, outros HTTP, falha). Respeitar Retry-After em 429, interromper fila ao primeiro rate limit, aplicar intervalo conservador mínimo de 3 segundos entre consultas e limitar verificações por sessão (máximo 30). Não usar proxies rotativos, não contornar rate limits, não usar tokens de usuário/bot, não automatizar login, não fazer requisições concorrentes nem varrer o espaço completo de combinações.
6. Permitir selecionar candidatos específicos e verificar sequencialmente. Progresso, botão parar, histórico local, exportar CSV. Estados devem ser visualmente distintos e texto de aviso permanente: "Não encontrado NÃO significa disponível para vanity URL".
7. Para confirmação final, incluir instruções e link para documentação/ajuda oficial do Discord sobre vanity URL, sem tentar consultar endpoint privado nem prometer disponibilidade.
8. Se a função server-side não puder ser criada neste projeto, não simule resultado: implemente modo de verificação desativado com explicação honesta e ainda mantenha catálogo, filtros, favoritos, links de convite e CSV funcionais.
9. Nunca exibir uma lista com status "DISPONÍVEL" sem confirmação oficial apropriada. Incluir botão "Abrir Discord" e instruções para o usuário verificar dentro do painel do servidor elegível.
10. Inclua estado de erro e empty states claros. Teste as funcionalidades principais e corrija erros.

Visual simples e funcional. Não é necessário luxo. Não use credenciais do usuário. Não peça login do Discord. Faça o app completo e prepare para publicação pública.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://invite-spark-finder.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ee39422f-aa77-44ec-b006-44336482a2f3).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
