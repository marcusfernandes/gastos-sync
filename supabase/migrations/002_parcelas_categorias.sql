-- Parcelas estruturadas, categorias editáveis, regras de categoria e responsável pela receita.

alter table public.transacoes
  add column if not exists parcela_atual  smallint check (parcela_atual > 0),
  add column if not exists parcelas_total smallint check (parcelas_total > 0);

update public.transacoes
set parcela_atual  = (regexp_match(estabelecimento, 'parcela\s*(\d+)\s*/\s*(\d+)', 'i'))[1]::smallint,
    parcelas_total = (regexp_match(estabelecimento, 'parcela\s*(\d+)\s*/\s*(\d+)', 'i'))[2]::smallint
where parcelas_total is null and estabelecimento ~* 'parcela\s*\d+\s*/\s*\d+';

alter table public.planejamento add column if not exists responsavel text;

create table if not exists public.categorias (
  nome       text primary key,
  padrao     boolean not null default false,
  criado_em  timestamptz not null default now()
);

insert into public.categorias (nome, padrao) values
  ('Alimentação', true), ('Mercado', true), ('Transporte', true), ('Moradia', true),
  ('Contas e Serviços', true), ('Saúde', true), ('Educação', true), ('Lazer', true),
  ('Compras', true), ('Assinaturas', true), ('Viagem', true), ('Mudança', true),
  ('Transferências', true), ('Renda', true), ('Impostos e Taxas', true), ('Outros', true)
on conflict (nome) do nothing;

insert into public.categorias (nome)
select distinct categoria from public.transacoes
union select distinct categoria from public.planejamento
on conflict (nome) do nothing;

-- Renomear uma categoria propaga para os lançamentos; excluir devolve-os para "Outros".
alter table public.transacoes drop constraint if exists transacoes_categoria_fk;
alter table public.transacoes add constraint transacoes_categoria_fk
  foreign key (categoria) references public.categorias (nome) on update cascade on delete set default;
alter table public.planejamento drop constraint if exists planejamento_categoria_fk;
alter table public.planejamento add constraint planejamento_categoria_fk
  foreign key (categoria) references public.categorias (nome) on update cascade on delete set default;

-- "Lembrar para este estabelecimento": estabelecimento normalizado -> categoria.
create table if not exists public.regras_categoria (
  padrao     text primary key,
  categoria  text not null references public.categorias (nome) on update cascade on delete cascade,
  criado_em  timestamptz not null default now()
);

alter table public.categorias enable row level security;
alter table public.regras_categoria enable row level security;
