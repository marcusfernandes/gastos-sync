-- Transações extraídas dos e-mails (idempotentes via dedupe_key).
create table if not exists public.transacoes (
  id               bigint generated always as identity primary key,
  data             date           not null,
  valor            numeric(12, 2) not null check (valor > 0),
  estabelecimento  text           not null,
  conta_ou_cartao  text           not null,
  categoria        text           not null default 'Outros',
  tipo             text           not null default 'compra'
                   check (tipo in ('compra', 'pix_enviado', 'pix_recebido', 'debito', 'fatura', 'outro')),
  vencimento       date,
  origem_email_id  text,
  origem_assunto   text,
  dedupe_key       text           not null unique,
  criado_em        timestamptz    not null default now()
);

create index if not exists transacoes_data_idx on public.transacoes (data);
create index if not exists transacoes_vencimento_idx on public.transacoes (vencimento) where tipo = 'fatura';

-- Entradas e saídas planejadas: salário, aluguel, assinaturas e custos pontuais da mudança.
create table if not exists public.planejamento (
  id          bigint generated always as identity primary key,
  descricao   text           not null,
  direcao     text           not null check (direcao in ('entrada', 'saida')),
  valor       numeric(12, 2) not null check (valor > 0),
  categoria   text           not null default 'Outros',
  recorrente  boolean        not null default true,
  inicio      date           not null default date_trunc('month', now())::date,
  fim         date,
  criado_em   timestamptz    not null default now()
);

-- Acesso apenas pela service role (o script); nenhum acesso anônimo.
alter table public.transacoes enable row level security;
alter table public.planejamento enable row level security;
