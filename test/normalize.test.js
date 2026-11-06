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

test('parcelas viram campos estruturados e compras herdam o vencimento da fatura', async () => {
  const { normalizeTransacao, posProcessar, chaveEstabelecimento } = await import('../src/parser/normalize.js');
  const email = { id: 'f', date: '2026-11-05T10:00:00Z' };
  const a = normalizeTransacao({ data: '2026-10-05', valor: 85.28, estabelecimento: 'Mercadolivre parcela 3/12', conta_ou_cartao: 'Nubank', categoria: 'Compras', tipo: 'compra' }, email);
  assert.equal(a.estabelecimento, 'Mercadolivre (parcela 3/12)');
  assert.deepEqual([a.parcela_atual, a.parcelas_total], [3, 12]);
  const b = normalizeTransacao({ data: '2026-10-06', valor: 10, estabelecimento: 'Padaria', conta_ou_cartao: 'Nubank', categoria: 'Inexistente', tipo: 'compra' }, email, ['Outros', 'Padarias']);
  assert.equal(b.categoria, 'Outros');
  assert.equal(b.parcelas_total, null);
  const f = normalizeTransacao({ data: '2026-11-05', valor: 95.28, estabelecimento: 'Fatura Nubank', conta_ou_cartao: 'Nubank', categoria: 'Contas e Serviços', tipo: 'fatura', vencimento: '2026-11-12' }, email);
  const out = posProcessar([a, b, f], new Map([[chaveEstabelecimento('Padaria'), 'Padarias']]));
  assert.equal(out[0].vencimento, '2026-11-12');
  assert.equal(out[1].categoria, 'Padarias');
  assert.equal(chaveEstabelecimento('Mercadolivre (parcela 4/12)'), chaveEstabelecimento('MERCADOLIVRE'));
});
