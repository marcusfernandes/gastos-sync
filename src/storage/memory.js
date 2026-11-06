import { uniqueByKey } from './index.js';

// Backend em memória para desenvolvimento local e demonstrações (dados somem ao reiniciar).
export function createMemoryStorage({ transacoes = [], planejamento = [] } = {}) {
  let seq = 1;
  const tx = transacoes.map((t) => ({ id: seq++, ...t }));
  const plan = planejamento.map((p) => ({ id: seq++, ...p }));
  const cfg = new Map();

  return {
    async saveTransacoes(rows) {
      const keys = new Set(tx.map((t) => t.dedupe_key));
      const novos = uniqueByKey(rows).filter((r) => !keys.has(r.dedupe_key));
      novos.forEach((r) => tx.push({ id: seq++, ...r }));
      return { inserted: novos, skipped: rows.length - novos.length };
    },
    async listTransacoes({ desde } = {}) {
      return tx.filter((t) => !desde || t.data >= desde || (t.vencimento && t.vencimento >= desde));
    },
    async deleteTransacao(id) {
      const i = tx.findIndex((t) => String(t.id) === String(id));
      if (i >= 0) tx.splice(i, 1);
    },
    async listPlanejamento() {
      return [...plan].sort((a, b) => (a.inicio < b.inicio ? -1 : 1));
    },
    async addPlanejamento(item) {
      const row = { id: seq++, ...item };
      plan.push(row);
      return row;
    },
    async deletePlanejamento(id) {
      const i = plan.findIndex((p) => String(p.id) === String(id));
      if (i >= 0) plan.splice(i, 1);
    },
    async getConfig(k) {
      return cfg.get(k) ?? null;
    },
    async setConfig(k, v) {
      cfg.set(k, v);
    },
  };
}
