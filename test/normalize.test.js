import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeKey, normalizeTransacao, parseData, parseValor } from '../src/parser/normalize.js';

const email = { id: 'msg1', subject: 'Compra aprovada', date: '2026-11-05T15:31:00.000Z' };

test('parseValor aceita formatos brasileiros e números', () => {
  assert.equal(parseValor('R$ 1.234,56'), 1234.56);
  assert.equal(parseValor('89,90'), 89.9);
  assert.equal(parseValor('1234.5'), 1234.5);
  assert.equal(parseValor(-42.1), 42.1);
});

test('parseData aceita ISO e dd/mm/yyyy, com fallback', () => {
  assert.equal(parseData('2026-11-05'), '2026-11-05');
  assert.equal(parseData('05/11/2026'), '2026-11-05');
  assert.equal(parseData('ontem', '2026-11-04T10:00:00Z'), '2026-11-04');
});

test('normalizeTransacao valida campos e corrige enums', () => {
  const t = normalizeTransacao(
    { data: '05/11/2026', valor: '1.234,56', estabelecimento: ' Padaria ', conta_ou_cartao: 'Nubank', categoria: 'X', tipo: 'y' },
    email,
  );
  assert.equal(t.data, '2026-11-05');
  assert.equal(t.valor, 1234.56);
  assert.equal(t.estabelecimento, 'Padaria');
  assert.equal(t.categoria, 'Outros');
  assert.equal(t.tipo, 'outro');
  assert.equal(t.origem_email_id, 'msg1');
  assert.match(t.dedupe_key, /^[0-9a-f]{64}$/);
});

test('normalizeTransacao descarta itens inválidos', () => {
  assert.equal(normalizeTransacao({ valor: 0, estabelecimento: 'x' }, email), null);
  assert.equal(normalizeTransacao({ valor: 10, estabelecimento: '' }, email), null);
});

test('dedupeKey ignora caixa, acentos e pontuação do estabelecimento', () => {
  const a = dedupeKey({ data: '2026-11-05', valor: 10, estabelecimento: 'Padaria São José' });
  const b = dedupeKey({ data: '2026-11-05', valor: 10.0, estabelecimento: 'PADARIA SAO JOSE.' });
  const c = dedupeKey({ data: '2026-11-05', valor: 10.01, estabelecimento: 'Padaria São José' });
  assert.equal(a, b);
  assert.notEqual(a, c);
});
