import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMeses, mediaVariavel, projecao, resumoMensal } from '../src/summary/forecast.js';

const t = (data, valor, categoria, tipo = 'compra', extra = {}) => ({ data, valor, categoria, tipo, conta_ou_cartao: 'Nubank', ...extra });

const transacoes = [
  t('2026-08-10', 1000, 'Mercado'),
  t('2026-09-10', 1200, 'Mercado'),
  t('2026-10-10', 800, 'Mercado'),
  t('2026-10-05', 3200, 'Moradia', 'pix_enviado'),
  t('2026-10-01', 12000, 'Renda', 'pix_recebido'),
  t('2026-10-02', 2500, 'Fatura', 'fatura', { vencimento: '2026-11-10' }),
  t('2026-11-03', 150, 'Alimentação'),
];
const planejamento = [
  { descricao: 'Salário', direcao: 'entrada', valor: 12000, categoria: 'Renda', recorrente: true, inicio: '2026-01-01', fim: null },
  { descricao: 'Aluguel', direcao: 'saida', valor: 3200, categoria: 'Moradia', recorrente: true, inicio: '2026-01-01', fim: '2027-01-31' },
  { descricao: 'Aluguel novo', direcao: 'saida', valor: 4000, categoria: 'Moradia', recorrente: true, inicio: '2027-02-01', fim: null },
  { descricao: 'Caução', direcao: 'saida', valor: 12000, categoria: 'Mudança', recorrente: false, inicio: '2027-01-15', fim: null },
];

test('addMeses atravessa anos', () => {
  assert.equal(addMeses('2026-11', 3), '2027-02');
  assert.equal(addMeses('2026-01', -1), '2025-12');
});

test('resumoMensal separa gastos, entradas e faturas', () => {
  const r = resumoMensal(transacoes, planejamento, '2026-10');
  assert.equal(r.entradas.cadastradas, 12000);
  assert.equal(r.entradas.recebidas_pix, 12000);
  assert.equal(r.gastos.registrados, 4000);
  assert.equal(r.gastos.fixos_planejados, 3200);
  assert.deepEqual(r.gastos.por_categoria, { Moradia: 3200, Mercado: 800 });
  assert.equal(resumoMensal(transacoes, planejamento, '2026-11').faturas.total_vencendo, 2500);
});

test('mediaVariavel ignora categorias de despesas fixas e o mês corrente', () => {
  assert.equal(mediaVariavel(transacoes, planejamento, '2026-11', 3), 1000);
});

test('projecao acumula saldo e aplica mudanças de aluguel e custos pontuais', () => {
  const p = projecao(transacoes, planejamento, { mesAtual: '2026-11', meses: 4, saldoInicial: 5000 });
  assert.deepEqual(p.meses.map((m) => m.mes), ['2026-12', '2027-01', '2027-02', '2027-03']);
  assert.deepEqual(p.meses.map((m) => m.saldo_projetado), [12800, 8600, 15600, 22600]);
  assert.equal(p.meses[1].gastos_pontuais, 12000);
  assert.deepEqual(p.menor_saldo, { mes: '2027-01', valor: 8600 });
  assert.equal(p.alerta, null);
});
