import { config } from '../config.js';

const BASE = 'https://api.pluggy.ai';

export function createPluggy({ clientId, clientSecret } = config.pluggy, fetchFn = fetch) {
  let apiKey;
  let expira = 0;

  async function chave() {
    if (apiKey && Date.now() < expira) return apiKey;
    const r = await fetchFn(`${BASE}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret }),
    });
    if (!r.ok) throw new Error(`Pluggy auth ${r.status}: ${(await r.text()).slice(0, 200)}`);
    apiKey = (await r.json()).apiKey;
    expira = Date.now() + 100 * 60 * 1000; // a chave vale 2h
    return apiKey;
  }

  async function get(path, params = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''));
    const r = await fetchFn(`${BASE}${path}${qs.size ? `?${qs}` : ''}`, { headers: { 'X-API-KEY': await chave() } });
    if (!r.ok) throw new Error(`Pluggy ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }

  async function paginado(path, params) {
    const out = [];
    for (let page = 1; ; page++) {
      const r = await get(path, { ...params, page, pageSize: 500 });
      out.push(...(r.results || []));
      if (!r.totalPages || page >= r.totalPages) return out;
    }
  }

  return {
    item: (id) => get(`/items/${id}`),
    contas: async (itemId) => (await get('/accounts', { itemId })).results || [],
    transacoes: (accountId, { from, to } = {}) => paginado('/transactions', { accountId, from, to }),
    faturas: async (accountId) => (await get('/bills', { accountId })).results || [],
  };
}
