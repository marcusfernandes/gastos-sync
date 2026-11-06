import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runIngestion } from '../src/ingest.js';
import { normalizeTransacao } from '../src/parser/normalize.js';
import { createSupabaseStorage } from '../src/storage/supabase.js';

const emails = [
  { id: 'a', subject: 'Compra aprovada', date: '2026-11-05T12:00:00Z', body: '...' },
  { id: 'b', subject: 'Compra aprovada (reenvio)', date: '2026-11-05T12:05:00Z', body: '...' },
  { id: 'c', subject: 'Erro', date: '2026-11-05T12:10:00Z', body: '...' },
];
const raw = { data: '2026-11-05', valor: 50, estabelecimento: 'Uber', conta_ou_cartao: 'Nubank', categoria: 'Transporte', tipo: 'compra' };

function fakeSupabase() {
  const rows = new Map();
  return {
    rows,
    from: () => ({
      upsert(batch) {
        const inserted = batch.filter((r) => !rows.has(r.dedupe_key));
        inserted.forEach((r) => rows.set(r.dedupe_key, r));
        return { select: async () => ({ data: inserted.map((r) => ({ dedupe_key: r.dedupe_key })), error: null }) };
      },
    }),
  };
}

test('pipeline salva sem duplicar e só marca e-mails processados com sucesso', async () => {
  const db = fakeSupabase();
  const marked = [];
  const deps = {
    fetchEmails: async () => emails,
    parse: async (email) => {
      if (email.id === 'c') throw new Error('Gemini indisponível');
      return [normalizeTransacao(raw, email)];
    },
    storage: createSupabaseStorage(db),
    markProcessed: async (ids) => marked.push(...ids),
    log: () => {},
  };

  const r1 = await runIngestion(deps);
  assert.equal(r1.inserted.length, 1);
  assert.equal(r1.skipped, 1);
  assert.equal(r1.falhas.length, 1);
  assert.deepEqual(marked, ['a', 'b']);

  const r2 = await runIngestion(deps);
  assert.equal(r2.inserted.length, 0);
  assert.equal(db.rows.size, 1);
});

test('dry-run não salva nem marca', async () => {
  let saved = false;
  let marked = false;
  const r = await runIngestion({
    fetchEmails: async () => emails.slice(0, 1),
    parse: async (email) => [normalizeTransacao(raw, email)],
    storage: { saveTransacoes: async () => { saved = true; } },
    markProcessed: async () => { marked = true; },
    dryRun: true,
    log: () => {},
  });
  assert.equal(r.transacoes.length, 1);
  assert.equal(saved, false);
  assert.equal(marked, false);
});
