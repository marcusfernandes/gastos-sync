# gastos-sync

Consolida gastos de vários bancos lendo os e-mails de notificação (compras aprovadas, Pix, faturas) no Gmail, extraindo os dados com o Gemini e salvando no Supabase (ou Google Sheets). Inclui um resumo mensal e uma projeção de saldo para planejar a mudança.

```
Gmail (e-mails de bancos) ──> Gemini (JSON estruturado) ──> Supabase / Sheets ──> /resumo e /projecao
```

## Estrutura

```
gastos-sync/
├── .env.example                  # todas as variáveis de ambiente
├── .github/workflows/ingest.yml  # execução agendada (GitHub Actions, a cada 3h)
├── package.json
├── scripts/
│   ├── auth-gmail.js             # gera o GOOGLE_REFRESH_TOKEN (uma vez)
│   └── parse-file.js             # testa o parser com um e-mail salvo em arquivo
├── src/
│   ├── config.js                 # env, categorias e tipos
│   ├── ingest.js                 # pipeline: Gmail -> Gemini -> storage -> marca no Gmail
│   ├── server.js                 # API HTTP de resumo/projeção
│   ├── gmail/client.js           # busca, decodifica e rotula e-mails
│   ├── parser/
│   │   ├── prompt.js             # prompt + JSON Schema da resposta
│   │   ├── gemini.js             # chamada ao Gemini (structured output + retry)
│   │   └── normalize.js          # validação, normalização e chave de deduplicação
│   ├── storage/
│   │   ├── index.js              # escolhe o backend (STORAGE_BACKEND)
│   │   ├── supabase.js
│   │   └── sheets.js
│   └── summary/
│       ├── forecast.js           # cálculos puros (resumo mensal e projeção)
│       ├── service.js            # carrega dados do storage
│       └── cli.js                # `npm run resumo`
├── supabase/
│   ├── migrations/001_init.sql   # tabelas transacoes e planejamento
│   └── seed.example.sql          # exemplo de renda, aluguel e custos de mudança
└── test/                         # node:test (sem dependências externas)
```

## Instalação

Requer Node.js 20.6+ (usa `--env-file`, sem `dotenv`).

```bash
npm install            # googleapis, @google/genai, @supabase/supabase-js
cp .env.example .env
```

### 1. Google Cloud (Gmail)
1. Crie um projeto em https://console.cloud.google.com e ative a **Gmail API** (e a **Google Sheets API** se for usar Sheets).
2. *OAuth consent screen*: tipo External, adicione seu e-mail como *test user*. **Publique o app ("In production")**: em modo *Testing* o refresh token expira em 7 dias. Para uso pessoal não é preciso passar pela verificação; basta aceitar o aviso de "app não verificado".
3. *Credentials > Create credentials > OAuth client ID*, tipo **Desktop app**. Copie o ID e o secret para `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. Rode `npm run auth:gmail`, abra a URL, autorize e cole o `GOOGLE_REFRESH_TOKEN` exibido no `.env`.
   (Com `STORAGE_BACKEND=sheets`, o mesmo token também recebe o escopo do Sheets.)

Escopo usado: `gmail.modify`, necessário apenas para aplicar o rótulo `gastos-sync/processado`; o script não apaga nem envia e-mails.

### 2. Gemini
Crie uma chave em https://aistudio.google.com/apikey e defina `GEMINI_API_KEY`. O modelo padrão é `gemini-2.5-flash` (configurável via `GEMINI_MODEL`).

### 3a. Supabase (padrão)
1. Crie um projeto e rode `supabase/migrations/001_init.sql` no SQL Editor.
2. Ajuste e rode `supabase/seed.example.sql` para cadastrar renda, despesas fixas e custos da mudança.
3. Defina `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (Project Settings > API). O RLS fica ativo sem políticas, então só a service role acessa os dados.

### 3b. Google Sheets (alternativa)
`STORAGE_BACKEND=sheets` e `GOOGLE_SHEETS_ID=<id da URL>`. Crie as abas:
- `transacoes`: o cabeçalho é criado automaticamente.
- `planejamento`: cabeçalho `descricao | direcao | valor | categoria | recorrente | inicio | fim` (direcao = `entrada`/`saida`, recorrente = `true`/`false`, datas `YYYY-MM-DD` ou `dd/mm/aaaa`).

## Uso

```bash
npm run parse:file -- test/fixtures/nubank-compra.html   # testa só o Gemini
npm run ingest:dry      # lê o Gmail e mostra o que seria salvo (não grava nem rotula)
npm run ingest          # grava e rotula os e-mails processados
npm run resumo -- --mes 2026-11 --meses 6 --saldo 15000
npm run server          # GET /resumo, /projecao, / (ambos), /health
                        # ex: /projecao?mes=2026-11&meses=12&saldo_inicial=15000
npm test
```

### Agendamento
- **GitHub Actions** (sem servidor): faça push para um repositório **privado**, cadastre os secrets usados em `.github/workflows/ingest.yml` e pronto: roda a cada 3h, com disparo manual disponível.
- **cron local**: `0 */3 * * * cd /caminho/gastos-sync && npm run ingest >> ingest.log 2>&1`

## Como funciona

**JSON extraído** (por e-mail pode vir mais de uma transação):

```json
{
  "data": "2026-11-05",
  "valor": 1234.56,
  "estabelecimento": "Padaria São José",
  "conta_ou_cartao": "Nubank",
  "categoria": "Alimentação",
  "tipo": "compra",
  "vencimento": null
}
```

Além dos 5 campos pedidos, `tipo` (`compra`, `pix_enviado`, `pix_recebido`, `debito`, `fatura`, `outro`) evita misturar Pix recebido com gasto e não soma a fatura em cima das compras que ela já contém. E-mails sem transação (marketing, alertas de login) retornam lista vazia e só são rotulados.

**Idempotência** em duas camadas:
1. Os e-mails processados recebem o rótulo `gastos-sync/processado` e saem da busca seguinte. O rótulo só é aplicado **depois** de salvar; e-mails com erro no Gemini ficam para a próxima execução.
2. `dedupe_key = sha256(data | valor | estabelecimento normalizado)`, com `UNIQUE` no Supabase (`upsert ... ignoreDuplicates`) e checagem prévia no Sheets. Pega reenvios e notificações duplicadas (ex.: e-mail de "compra aprovada" e comprovante do mesmo gasto).

> Limitação: duas compras idênticas no mesmo dia e no mesmo estabelecimento (ex.: dois cafés de R$ 8) viram uma só. Se isso incomodar, inclua `conta_ou_cartao` ou o horário na chave em `src/parser/normalize.js`.

**Resumo e projeção** (`src/summary/forecast.js`):
- *Resumo do mês*: entradas cadastradas (`planejamento`) e Pix recebidos, gastos registrados por categoria, fixos/pontuais planejados e faturas que vencem no mês.
- *Projeção*: para cada mês futuro, `entradas planejadas − (fixos + pontuais + média de gastos variáveis)`, acumulando a partir de `SALDO_INICIAL`. A média variável usa os últimos `MESES_HISTORICO_VARIAVEL` meses fechados e **exclui as categorias das despesas fixas planejadas** (ex.: se o aluguel está em `planejamento` como Moradia, o Pix do aluguel não entra de novo na média). A resposta indica o mês de menor saldo e alerta se ficar negativo.
- Custos da mudança: cadastre em `planejamento` com `recorrente=false` (caução, frete, móveis) e a troca de aluguel como duas linhas recorrentes com `fim`/`inicio`.

## Próximos passos sugeridos
- Ajustar `GMAIL_QUERY` com os remetentes exatos dos seus bancos (veja no `ingest:dry` o que está entrando).
- Regras locais de categoria (ex.: "UBER" → Transporte) antes de chamar o Gemini, para economizar chamadas.
- Dashboard simples (Supabase + Looker Studio / Metabase, ou uma página consumindo `/projecao`).
