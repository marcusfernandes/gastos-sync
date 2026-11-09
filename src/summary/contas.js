import { planejadoNoMes } from './forecast.js';
import { normalizarTexto } from '../parser/normalize.js';

const round = (n) => Math.round(n * 100) / 100;
const mesDe = (d) => String(d).slice(0, 7);
const cartaoDe = (t) => String(t.conta_ou_cartao || '').toLowerCase().split(/\s+/)[0];
const DIA_MS = 86400000;

export const chaveFixo = (descricao) => `fixo:${normalizarTexto(descricao)}`;

function dataNoMes(mes, dia) {
  if (!dia) return null;
  const [y, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${mes}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
}

const maisComum = (valores) => {
  const n = new Map();
  for (const v of valores.filter(Boolean)) n.set(v, (n.get(v) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

function status(conta, hoje) {
  if (conta.pago_em) return 'pago';
  if (!conta.vencimento) return 'sem_data';
  const dias = Math.round((Date.parse(conta.vencimento) - Date.parse(hoje)) / DIA_MS);
  if (dias < 0) return 'atrasada';
  if (dias <= 3) return 'vence_logo';
  return 'aberta';
}

// Contas a pagar do mês: gastos planejados (fixos e pontuais) e uma linha por cartão.
// O valor do cartão é o da fatura quando ela existe; senão, a soma das compras com vencimento no mês.
export function contasDoMes(transacoes, planejamento, mes, { pagos = {}, dias = {}, hoje = new Date().toISOString().slice(0, 10) } = {}) {
  const contas = [];

  for (const p of planejamento.filter((p) => p.direcao === 'saida' && planejadoNoMes(p, mes))) {
    const chave = chaveFixo(p.descricao);
    contas.push({
      chave,
      tipo: 'fixo',
      descricao: p.descricao,
      categoria: p.categoria,
      valor: round(p.valor),
      vencimento: dataNoMes(mes, dias[chave]),
      dia: dias[chave] ?? null,
    });
  }

  const cartoes = new Map();
  for (const t of transacoes) {
    if (!['compra', 'fatura'].includes(t.tipo) || mesDe(t.vencimento || t.data) !== mes) continue;
    const k = cartaoDe(t);
    if (!k) continue;
    if (!cartoes.has(k)) cartoes.set(k, { faturas: [], compras: [] });
    cartoes.get(k)[t.tipo === 'fatura' ? 'faturas' : 'compras'].push(t);
  }
  for (const [k, { faturas, compras }] of cartoes) {
    const fatura = faturas.sort((a, b) => b.valor - a.valor)[0];
    const somaCompras = round(compras.reduce((s, t) => s + t.valor, 0));
    contas.push({
      chave: `cartao:${k}`,
      tipo: 'cartao',
      descricao: fatura?.conta_ou_cartao || maisComum(compras.map((t) => t.conta_ou_cartao)),
      categoria: 'Cartões (fatura)',
      valor: fatura ? round(fatura.valor) : somaCompras,
      vencimento: fatura?.vencimento || maisComum(compras.map((t) => t.vencimento)),
      compras: compras.length,
      parcial: !fatura,
    });
  }

  for (const c of contas) {
    c.pago_em = pagos[c.chave] || null;
    c.status = status(c, hoje);
  }
  const ordem = { atrasada: 0, vence_logo: 1, aberta: 2, sem_data: 3, pago: 4 };
  contas.sort((a, b) => ordem[a.status] - ordem[b.status] || String(a.vencimento || '9').localeCompare(String(b.vencimento || '9')));

  const total = round(contas.reduce((s, c) => s + c.valor, 0));
  const pago = round(contas.filter((c) => c.pago_em).reduce((s, c) => s + c.valor, 0));
  return {
    mes,
    contas,
    total,
    pago,
    em_aberto: round(total - pago),
    atrasadas: contas.filter((c) => c.status === 'atrasada').length,
    vencendo: contas.filter((c) => c.status === 'vence_logo').length,
  };
}

export const hojeBR = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
