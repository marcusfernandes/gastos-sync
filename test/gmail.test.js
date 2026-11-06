import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildQuery, extractBody, htmlToText } from '../src/gmail/client.js';

const b64url = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

test('extractBody prefere text/plain em mensagens multipart', () => {
  const payload = {
    mimeType: 'multipart/alternative',
    parts: [
      { mimeType: 'text/plain', body: { data: b64url('Compra de R$ 10,00 aprovada') } },
      { mimeType: 'text/html', body: { data: b64url('<b>ignorado</b>') } },
    ],
  };
  assert.equal(extractBody(payload), 'Compra de R$ 10,00 aprovada');
});

test('extractBody converte HTML quando não há text/plain', async () => {
  const html = await readFile(new URL('./fixtures/nubank-compra.html', import.meta.url), 'utf8');
  const text = extractBody({ mimeType: 'text/html', body: { data: b64url(html) } });
  assert.match(text, /R\$ 1\.234,56/);
  assert.match(text, /PADARIA/);
  assert.doesNotMatch(text, /color:red|<p>/);
});

test('htmlToText remove tags e entidades', () => {
  assert.equal(htmlToText('<p>A&nbsp;&amp;&nbsp;B</p>'), 'A & B');
});

test('buildQuery exclui e-mails já processados', () => {
  const q = buildQuery({ query: 'from:nubank.com.br', lookbackDays: 3, processedLabel: 'gastos-sync/processado' });
  assert.equal(q, 'from:nubank.com.br newer_than:3d -label:gastos-sync-processado');
});
