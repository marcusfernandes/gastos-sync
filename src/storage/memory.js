import { CATEGORIAS } from '../config.js';
import { uniqueByKey } from './index.js';

// Backend em memória para desenvolvimento local e demonstrações (dados somem ao reiniciar).
export function createMemoryStorage({ transacoes = [], planejamento = [] } = {}) {
  let seq = 1;
  const tx = transacoes.map((t) => ({ id: seq++, ...t }));
  const plan = planejamento.map((p) => ({ id: seq++, ...p }));
  const cfg = new Map();
  let categorias = [...CATEGORIAS];
  const regras = new Map();
  const renomear = (de, para) => [...tx, ...plan].forEach((r) => r.categoria === de && (r.categoria = para));

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
    async updateTransacoes(ids, patch) {
      const set = new Set(ids.map(String));
      tx.filter((t) => set.has(String(t.id))).forEach((t) => Object.assign(t, patch));
    },
    async listPlanejamento() {
      return [...plan].sort((a, b) => (a.inicio < b.inicio ? -1 : 1));
    },
    async addPlanejamento(item) {
      const row = { id: seq++, ...item };
      plan.push(row);
      return row;
    },
    async updatePlanejamento(id, patch) {
      const row = plan.find((p) => String(p.id) === String(id));
      if (!row) throw new Error('Item não encontrado');
      return Object.assign(row, patch);
    },
    async listCategorias() {
      return [...categorias].sort((a, b) => a.localeCompare(b));
    },
    async addCategoria(nome) {
      if (!categorias.includes(nome)) categorias.push(nome);
    },
    async renameCategoria(nome, novo) {
      categorias = categorias.map((c) => (c === nome ? novo : c));
      renomear(nome, novo);
      regras.forEach((c, k) => c === nome && regras.set(k, novo));
    },
    async deleteCategoria(nome) {
      categorias = categorias.filter((c) => c !== nome);
      renomear(nome, 'Outros');
      regras.forEach((c, k) => c === nome && regras.delete(k));
    },
    async listRegras() {
      return new Map(regras);
    },
    async saveRegra(padrao, categoria) {
      regras.set(padrao, categoria);
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
