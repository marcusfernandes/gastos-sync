import { createHash } from 'node:crypto';
import { CATEGORIAS, TIPOS } from '../config.js';

export function parseValor(raw) {
  if (typeof raw === 'number') return Math.abs(raw);
  if (typeof raw !== 'string') return Number.NaN;
  let s = raw.replace(/[^\d,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return Math.abs(Number.parseFloat(s));
}

export function parseData(raw, fallback) {
  if (typeof raw === 'string') {
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  }
  return fallback ? fallback.slice(0, 10) : null;
}

// Identifica o cartão pelo banco (1ª palavra); onde a casa tem mais de um cartão no mesmo banco,
// pelo produto. Assim "Infinit" (planilha), "Bradesco Visa Infinite" (e-mail/Open Finance) são o mesmo.
const PRODUTOS = [
  [/\binfinit/, 'bradesco infinite'],
  [/\bnanquim\b/, 'bradesco nanquim'],
];
export function cartaoDe(t) {
  const n = normalizarTexto(typeof t === 'string' ? t : t?.conta_ou_cartao);
  for (const [re, id] of PRODUTOS) if (re.test(n)) return id;
  return n.split(' ')[0];
}

export function normalizarTexto(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Faturas chegam repetidas em vários lembretes ("fechou", "vence amanhã", "venceu"):
// uma por cartão, valor e mês de vencimento.
export function dedupeKey({ data, valor, estabelecimento, tipo, vencimento, conta_ou_cartao }) {
  const base =
    tipo === 'fatura'
      ? `fatura|${normalizarTexto(conta_ou_cartao)}|${valor.toFixed(2)}|${(vencimento || data).slice(0, 7)}`
      : `${data}|${valor.toFixed(2)}|${normalizarTexto(estabelecimento)}`;
  return createHash('sha256').update(base).digest('hex');
}

const PARCELA_RE = /\(?\s*parcela\s*(\d+)\s*\/\s*(\d+)\s*\)?/i;

// Estabelecimento sem o sufixo de parcela, normalizado: identifica a mesma loja/compra entre faturas.
export function chaveEstabelecimento(estabelecimento) {
  return normalizarTexto(String(estabelecimento || '').replace(PARCELA_RE, ''));
}

function parcelas(raw, estabelecimento) {
  let atual = Number.parseInt(raw.parcela_atual, 10);
  let total = Number.parseInt(raw.parcelas_total, 10);
  const m = estabelecimento.match(PARCELA_RE);
  if (!(total > 1) && m) [atual, total] = [Number(m[1]), Number(m[2])];
  if (!(total > 1) || !(atual >= 1) || atual > total) return { estabelecimento, parcela_atual: null, parcelas_total: null };
  const base = estabelecimento.replace(PARCELA_RE, '').trim().replace(/[\s\-–:,]+$/, '');
  return { estabelecimento: `${base} (parcela ${atual}/${total})`, parcela_atual: atual, parcelas_total: total };
}

export function normalizeTransacao(raw, email, categorias = CATEGORIAS) {
  const valor = Math.round(parseValor(raw.valor) * 100) / 100;
  const data = parseData(raw.data, email?.date);
  if (!Number.isFinite(valor) || valor <= 0 || !data || !String(raw.estabelecimento || '').trim()) return null;

  const tipo = TIPOS.includes(raw.tipo) ? raw.tipo : 'outro';
  const categoria = categorias.includes(raw.categoria) ? raw.categoria : 'Outros';
  const p = tipo === 'compra' ? parcelas(raw, String(raw.estabelecimento).trim()) : { estabelecimento: String(raw.estabelecimento).trim(), parcela_atual: null, parcelas_total: null };
  const t = {
    data,
    valor,
    estabelecimento: p.estabelecimento,
    conta_ou_cartao: String(raw.conta_ou_cartao || 'Desconhecido').trim(),
    categoria,
    tipo,
    vencimento: tipo === 'fatura' || tipo === 'compra' ? parseData(raw.vencimento, null) : null,
    parcela_atual: p.parcela_atual,
    parcelas_total: p.parcelas_total,
    origem_email_id: email?.id ?? null,
    origem_assunto: email?.subject ?? null,
  };
  t.dedupe_key = dedupeKey(t);
  return t;
}

// Compras lidas de uma fatura herdam o vencimento dela (mês em que a parcela é cobrada);
// regras salvas pelo usuário têm prioridade sobre a categoria sugerida pela IA.
export function posProcessar(transacoes, regras = new Map()) {
  const fatura = transacoes.find((t) => t.tipo === 'fatura' && t.vencimento);
  return transacoes.map((t) => {
    const out = { ...t };
    if (out.tipo === 'compra' && !out.vencimento && fatura) out.vencimento = fatura.vencimento;
    const regra = regras.get(chaveEstabelecimento(out.estabelecimento));
    if (regra) out.categoria = regra;
    return out;
  });
}
