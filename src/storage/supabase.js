import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { TRANSACAO_COLUNAS, uniqueByKey } from './index.js';

export function createSupabaseStorage(client) {
  const db =
    client ??
    createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: { persistSession: false },
    });

  return {
    async saveTransacoes(rows) {
      const unique = uniqueByKey(rows).map((r) =>
        Object.fromEntries(TRANSACAO_COLUNAS.map((c) => [c, r[c] ?? null])),
      );
      if (!unique.length) return { inserted: [], skipped: rows.length };
      const { data, error } = await db
        .from('transacoes')
        .upsert(unique, { onConflict: 'dedupe_key', ignoreDuplicates: true })
        .select('dedupe_key');
      if (error) throw new Error(`Supabase: ${error.message}`);
      const insertedKeys = new Set((data || []).map((d) => d.dedupe_key));
      return {
        inserted: unique.filter((r) => insertedKeys.has(r.dedupe_key)),
        skipped: rows.length - insertedKeys.size,
      };
    },

    async listTransacoes({ desde } = {}) {
      let q = db.from('transacoes').select('*').order('data');
      if (desde) q = q.or(`data.gte.${desde},vencimento.gte.${desde}`);
      const { data, error } = await q;
      if (error) throw new Error(`Supabase: ${error.message}`);
      return data.map((t) => ({ ...t, valor: Number(t.valor) }));
    },

    async deleteTransacao(id) {
      const { error } = await db.from('transacoes').delete().eq('id', id);
      if (error) throw new Error(`Supabase: ${error.message}`);
    },

    async listPlanejamento() {
      const { data, error } = await db.from('planejamento').select('*').order('inicio');
      if (error) throw new Error(`Supabase: ${error.message}`);
      return data.map((p) => ({ ...p, valor: Number(p.valor) }));
    },

    async addPlanejamento(item) {
      const { data, error } = await db.from('planejamento').insert(item).select().single();
      if (error) throw new Error(`Supabase: ${error.message}`);
      return { ...data, valor: Number(data.valor) };
    },

    async deletePlanejamento(id) {
      const { error } = await db.from('planejamento').delete().eq('id', id);
      if (error) throw new Error(`Supabase: ${error.message}`);
    },

    async getConfig(chave) {
      const { data, error } = await db.from('app_config').select('valor').eq('chave', chave).maybeSingle();
      if (error) throw new Error(`Supabase: ${error.message}`);
      return data?.valor ?? null;
    },

    async setConfig(chave, valor) {
      const { error } = await db
        .from('app_config')
        .upsert({ chave, valor, atualizado_em: new Date().toISOString() });
      if (error) throw new Error(`Supabase: ${error.message}`);
    },
  };
}
