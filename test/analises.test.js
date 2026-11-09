import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assinaturas, conferencia, orcamentoDoMes } from '../src/summary/analises.js';
import { comEconomia } from '../src/plano.js';

const c = (data, estabelecimento, valor, extra = {}) => ({ id: `${data}-${estabelecimento}-${valor}`, tipo: 'compra', conta_ou_cartao: 'Nubank', categoria: 'Lazer', data, estabelecimento, valor, ...extra });

test('orçamento: gasto do mês por categoria contra a meta, cartão no mês da fatura', () => {
  const tx = [
    c('2026-10-20', 'Cinema', 90, { vencimento: '2026-11-12' }),
    c('2026-11-02', 'Bar', 20, { tipo: 'pix_enviado' }),
    c('2026-11-03', 'Mercado X', 50, { categoria: 'Mercado', tipo: 'debito' }),
    c('2026-10-05', 'Show', 300, { vencimento: '2026-10-12' }),
  ];
  const o = orcamentoDoMes(tx, '2026-11', { Lazer: 100, Saúde: 200 });
  const lazer = o.itens.find((i) => i.categoria === 'Lazer');
  assert.equal(lazer.gasto, 110);
  assert.equal(lazer.nivel, 'estourou');
  assert.equal(lazer.media, 300);
  assert.equal(o.itens.find((i) => i.categoria === 'Saúde').nivel, 'ok');
  assert.equal(o.itens.find((i) => i.categoria === 'Mercado').limite, null);
  assert.equal(orcamentoDoMes([c('2026-11-01', 'A', 85, { tipo: 'debito' })], '2026-11', { Lazer: 100 }).itens[0].nivel, 'alerta');
});

test('assinaturas: recorrentes com valor parecido, aumento de preço e nova assinatura', () => {
  const tx = [
    ...['2026-08-05', '2026-09-05', '2026-10-05'].map((d) => c(d, 'Netflix', 39.9, { categoria: 'Assinaturas' })),
    c('2026-11-05', 'Netflix', 44.9, { categoria: 'Assinaturas' }),
    ...['2026-09-01', '2026-10-01', '2026-11-01'].map((d) => c(d, 'Spotify', 21.9)),
    ...['2026-09-10', '2026-10-10', '2026-11-10'].map((d, i) => c(d, 'Mercado Bom', 100 + i * 150)),
    ...['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-08'].map((d) => c(d, 'Uber', 20)),
    c('2026-11-07', 'Max', 29.9, { categoria: 'Assinaturas' }),
    c('2026-11-07', 'IOF de "Netflix"', 1.5),
    c('2026-11-07', 'Loja (parcela 3/5)', 21.9, { parcela_atual: 3, parcelas_total: 5 }),
  ];
  const a = assinaturas(tx, '2026-11');
  assert.deepEqual(a.itens.map((i) => i.estabelecimento).sort(), ['Max', 'Netflix', 'Spotify']);
  const netflix = a.itens.find((i) => i.estabelecimento === 'Netflix');
  assert.equal(netflix.aumento, 5);
  assert.equal(netflix.valor_anterior, 39.9);
  assert.equal(a.itens.find((i) => i.estabelecimento === 'Max').nova, true);
  assert.equal(a.total_mensal, 96.7);
});

test('conferência: fatura × soma das compras, repetidas e fora do padrão', () => {
  const hist = Array.from({ length: 6 }, (_, i) => c(`2026-0${i + 4}-10`, `Bar ${i}`, 50, { vencimento: `2026-0${i + 4}-12` }));
  const tx = [
    ...hist,
    { id: 'f', tipo: 'fatura', conta_ou_cartao: 'Nubank', valor: 1000, data: '2026-11-01', vencimento: '2026-11-12' },
    c('2026-10-20', 'Ifood *Rest', 80, { vencimento: '2026-11-12' }),
    c('2026-10-21', 'IFOOD', 80, { vencimento: '2026-11-12', id: 'dup' }),
    c('2026-10-25', 'Playstation', 700, { vencimento: '2026-11-12' }),
  ];
  const r = conferencia(tx, '2026-11');
  assert.equal(r.faturas.length, 1);
  assert.equal(r.faturas[0].soma_compras, 860);
  assert.equal(r.faturas[0].diferenca, 140);
  assert.equal(r.faturas[0].confere, false);
  assert.equal(r.duplicadas.length, 1);
  assert.equal(r.duplicadas[0][1].id, 'dup');
  assert.deepEqual(r.fora_do_padrao.map((t) => t.estabelecimento), ['Playstation']);
});

test('plano de corte: economia mensal acumula na projeção', () => {
  const proj = { meses: [{ mes: '2026-12', saldo_projetado: -100 }, { mes: '2027-01', saldo_projetado: -300 }] };
  assert.deepEqual(comEconomia(proj, 200), [
    { mes: '2026-12', sem_plano: -100, com_plano: 100 },
    { mes: '2027-01', sem_plano: -300, com_plano: 100 },
  ]);
});

test('plano de corte: economia necessária para nenhum mês ficar negativo', async () => {
  const { economiaNecessaria } = await import('../src/plano.js');
  assert.equal(economiaNecessaria({ meses: [{ saldo_projetado: -100 }, { saldo_projetado: -300 }, { saldo_projetado: 50 }] }), 150);
  assert.equal(economiaNecessaria({ meses: [{ saldo_projetado: 10 }] }), 0);
});
