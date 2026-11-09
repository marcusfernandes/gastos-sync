-- De quem é cada gasto (Marcão, Becca ou vazio = casal). Sem valor, vale o dono configurado do cartão/conta.
alter table public.transacoes add column if not exists responsavel text;
