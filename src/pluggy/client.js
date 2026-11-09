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


  return {
    item: (id) => get(`/items/${id}`),
    contas: async (itemId) => (await get('/accounts', { itemId })).results || [],
    transacoes: async (accountId, { from, to } = {}) => {
      const out = [];
      for (let after; ; ) {
        const r = await get('/v2/transactions', { accountId, dateFrom: from, dateTo: to, after });
        out.push(...(r.results || []));
        if (!r.next) return out;
        after = r.next;
      }
    },
    faturas: async (accountId) => (await get('/bills', { accountId })).results || [],
  };
}
