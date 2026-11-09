import { test } from 'node:test';
import assert from 'node:assert/strict';
import { custoNoMes, melhorInicio, simular } from '../web/src/lib/simulacao.js';

const meses = [
  { mes: '2026-12', resultado_mes: -200, saldo_projetado: 800 },
  { mes: '2027-01', resultado_mes: -300, saldo_projetado: 500 },
  { mes: '2027-02', resultado_mes: 400, saldo_projetado: 900 },
  { mes: '2027-03', resultado_mes: 600, saldo_projetado: 1500 },
  { mes: '2027-04', resultado_mes: 600, saldo_projetado: 2100 },
];

test('custo por mês considera entrada e parcelas', () => {
  const c = { valor: 1000, parcelas: 4, entrada: 200, inicio: '2027-01' };
  assert.equal(custoNoMes(c, '2027-01'), 400);
  assert.equal(custoNoMes(c, '2027-04'), 200);
  assert.equal(custoNoMes(c, '2027-05'), 0);
});

test('simular acumula o custo no saldo', () => {
  const s = simular(meses, { valor: 900, parcelas: 3, inicio: '2026-12' });
  assert.deepEqual(s.linhas.map((l) => l.saldo_com), [500, -100, 0, 600, 1200]);
  assert.equal(s.primeiro_negativo, '2027-01');
  assert.deepEqual(s.menor_depois, { mes: '2027-01', valor: -100 });
});

test('melhor início é o primeiro que não deixa o saldo negativo', () => {
  assert.equal(melhorInicio(meses, { valor: 900, parcelas: 3 }).inicio, '2027-01');
  assert.equal(melhorInicio(meses, { valor: 900, parcelas: 3 }, { margem: 250 }).inicio, '2027-02');
});
