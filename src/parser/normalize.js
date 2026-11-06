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

export function normalizarTexto(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function dedupeKey({ data, valor, estabelecimento }) {
  const base = `${data}|${valor.toFixed(2)}|${normalizarTexto(estabelecimento)}`;
  return createHash('sha256').update(base).digest('hex');
}

export function normalizeTransacao(raw, email) {
  const valor = Math.round(parseValor(raw.valor) * 100) / 100;
  const data = parseData(raw.data, email?.date);
  const estabelecimento = String(raw.estabelecimento || '').trim();
  if (!Number.isFinite(valor) || valor <= 0 || !data || !estabelecimento) return null;

  const tipo = TIPOS.includes(raw.tipo) ? raw.tipo : 'outro';
  const categoria = CATEGORIAS.includes(raw.categoria) ? raw.categoria : 'Outros';
  const t = {
    data,
    valor,
    estabelecimento,
    conta_ou_cartao: String(raw.conta_ou_cartao || 'Desconhecido').trim(),
    categoria,
    tipo,
    vencimento: tipo === 'fatura' ? parseData(raw.vencimento, null) : null,
    origem_email_id: email?.id ?? null,
    origem_assunto: email?.subject ?? null,
  };
  t.dedupe_key = dedupeKey(t);
  return t;
}
