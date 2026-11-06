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

// Interface: saveTransacoes(rows) -> { inserted, skipped }, listTransacoes({ desde }), listPlanejamento(),
// addPlanejamento(item); opcionais: deleteTransacao(id), deletePlanejamento(id), getConfig(k), setConfig(k, v).
export async function createStorage(backend = config.storageBackend) {
  if (backend === 'supabase') return (await import('./supabase.js')).createSupabaseStorage();
  if (backend === 'sheets') return (await import('./sheets.js')).createSheetsStorage();
  if (backend === 'memory') return (await import('./memory.js')).createMemoryStorage();
  throw new Error(`STORAGE_BACKEND inválido: ${backend} (use "supabase", "sheets" ou "memory")`);
}
