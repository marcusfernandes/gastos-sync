import { config } from '../config.js';

export const TRANSACAO_COLUNAS = [
  'data',
  'valor',
  'estabelecimento',
  'conta_ou_cartao',
  'categoria',
  'tipo',
  'vencimento',
  'origem_email_id',
  'origem_assunto',
  'dedupe_key',
];

export function uniqueByKey(rows) {
  const seen = new Set();
  return rows.filter((r) => !seen.has(r.dedupe_key) && seen.add(r.dedupe_key));
}

// Interface: saveTransacoes(rows) -> { inserted, skipped }, listTransacoes({ desde }), listPlanejamento()
export async function createStorage(backend = config.storageBackend) {
  if (backend === 'supabase') return (await import('./supabase.js')).createSupabaseStorage();
  if (backend === 'sheets') return (await import('./sheets.js')).createSheetsStorage();
  throw new Error(`STORAGE_BACKEND inválido: ${backend} (use "supabase" ou "sheets")`);
}
