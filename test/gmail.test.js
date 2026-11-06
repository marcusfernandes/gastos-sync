import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AUTOENVIO, buildQuery, extractBody, findPdfAttachments, forwardingAddress, htmlToText } from '../src/gmail/client.js';

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

test('buildQuery inclui o endereço de encaminhamento como alternativa', () => {
  const q = buildQuery({ query: 'from:nubank.com.br', lookbackDays: 3, processedLabel: 'p', forwardTo: 'a+gastos@gmail.com' });
  assert.equal(q, `{(from:nubank.com.br) to:a+gastos@gmail.com (${AUTOENVIO})} newer_than:3d -label:p`);
});

test('forwardingAddress deriva <usuario>+gastos do e-mail da conta', () => {
  assert.equal(forwardingAddress('marcus.palmas@gmail.com', 'auto'), 'marcus.palmas+gastos@gmail.com');
  assert.equal(forwardingAddress('x@y.com', 'off'), null);
  assert.equal(forwardingAddress('x@y.com', 'outro@y.com'), 'outro@y.com');
});

test('findPdfAttachments encontra PDFs em partes aninhadas', () => {
  const payload = {
    mimeType: 'multipart/mixed',
    parts: [
      { mimeType: 'text/plain', body: { data: b64url('Segue a fatura') } },
      { mimeType: 'application/octet-stream', filename: 'Fatura.PDF', body: { attachmentId: 'abc', size: 1000 } },
      { mimeType: 'image/png', filename: 'logo.png', body: { attachmentId: 'img', size: 10 } },
    ],
  };
  assert.deepEqual(findPdfAttachments(payload), [{ filename: 'Fatura.PDF', attachmentId: 'abc', data: undefined }]);
});
