-- Exemplo: ajuste os valores e rode no SQL Editor do Supabase.
insert into public.planejamento (descricao, direcao, valor, categoria, recorrente, inicio, fim) values
  ('Salário',               'entrada', 12000.00, 'Renda',             true,  '2026-11-01', null),
  ('Aluguel atual',         'saida',    3200.00, 'Moradia',           true,  '2026-11-01', '2027-01-31'),
  ('Aluguel novo',          'saida',    3800.00, 'Moradia',           true,  '2027-02-01', null),
  ('Internet + celular',    'saida',     250.00, 'Contas e Serviços', true,  '2026-11-01', null),
  ('Caução novo apartamento','saida',   7600.00, 'Mudança',           false, '2027-01-15', null),
  ('Transportadora',        'saida',    2500.00, 'Mudança',           false, '2027-02-01', null);
