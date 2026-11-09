import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chaveFixo, contasDoMes } from '../src/summary/contas.js';

const plan = [
  { descricao: 'Condomínio', direcao: 'saida', valor: 800, categoria: 'Moradia', recorrente: true, inicio: '2026-01-01', fim: null },
  { descricao: 'IPVA', direcao: 'saida', valor: 1200, categoria: 'Transporte', recorrente: false, inicio: '2026-03-01' },
  { descricao: 'Salário', direcao: 'entrada', valor: 9000, recorrente: true, inicio: '2026-01-01' },
];
const tx = [
  { tipo: 'compra', conta_ou_cartao: 'Nubank', valor: 100, data: '2026-10-20', vencimento: '2026-11-12' },
  { tipo: 'compra', conta_ou_cartao: 'Nubank', valor: 50.5, data: '2026-10-25', vencimento: '2026-11-12' },
  { tipo: 'fatura', conta_ou_cartao: 'Infinit Bradesco', valor: 6000, data: '2026-11-01', vencimento: '2026-11-05' },
  { tipo: 'compra', conta_ou_cartao: 'Infinit Bradesco', valor: 30, data: '2026-10-10', vencimento: '2026-11-05' },
  { tipo: 'pix_enviado', conta_ou_cartao: 'Nubank', valor: 70, data: '2026-11-02' },
];

test('contas do mês: fixos ativos e uma linha por cartão, fatura prevalece sobre compras', () => {
  const r = contasDoMes(tx, plan, '2026-11', { hoje: '2026-11-10', dias: { [chaveFixo('Condomínio')]: 31 } });
  assert.deepEqual(r.contas.map((c) => [c.chave, c.valor, c.vencimento, c.status]), [
    ['cartao:infinit', 6000, '2026-11-05', 'atrasada'],
    ['cartao:nubank', 150.5, '2026-11-12', 'vence_logo'],
    ['fixo:condominio', 800, '2026-11-30', 'aberta'],
  ]);
  assert.equal(r.contas.find((c) => c.chave === 'cartao:nubank').parcial, true);
  assert.equal(r.total, 6950.5);
  assert.equal(r.atrasadas, 1);
});

test('contas pagas saem do em aberto', () => {
  const r = contasDoMes(tx, plan, '2026-11', { hoje: '2026-11-10', pagos: { 'cartao:infinit': '2026-11-04T10:00:00Z' } });
  assert.equal(r.contas.find((c) => c.chave === 'cartao:infinit').status, 'pago');
  assert.equal(r.pago, 6000);
  assert.equal(r.em_aberto, 950.5);
  assert.equal(r.contas.at(-1).chave, 'cartao:infinit');
  assert.equal(r.contas.find((c) => c.chave === 'fixo:condominio').status, 'sem_data');
});
