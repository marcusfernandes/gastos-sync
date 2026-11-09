import { createHash } from 'node:crypto';
import { dedupeKey, normalizeTransacao } from '../parser/normalize.js';

const dia = (d) => (d ? String(d).slice(0, 10) : null);
const chave = (s) => createHash('sha256').update(`pluggy|${s}`).digest('hex');

// Movimentações da conta que não são gasto/receita do mês: pagamento de fatura (as compras
// já entram pelo cartão), aplicações/resgates e transferências entre contas próprias.
const NAO_CONTA =
  /fatura|pagto\.?\s*cart|pag(amento|to)?\s*(de\s*)?cart[aã]o|aplica[cç][aã]o|resgate|rende\s*f[aá]cil|invest|poupan[cç]a|cdb|tesouro|transf.*mesma\s*titularidade/i;
const CATEGORIAS_NAO_CONTA = /credit card payment|investment|same person|same ownership/i;

const BANCOS = [
  [/\bnu\s*pag|nubank/i, 'Nubank'],
  [/ita[uú]|\bpao de acucar\b/i, 'Itaú'],
  [/mercado\s*pago/i, 'Mercado Pago'],
  [/bradesco/i, 'Bradesco'],
  [/santander/i, 'Santander'],
  [/caixa/i, 'Caixa'],
  [/\binter\b/i, 'Inter'],
  [/\bc6\b/i, 'C6'],
  [/banco do brasil|\bbb\b/i, 'Banco do Brasil'],
  [/picpay/i, 'PicPay'],
];

// Itens do Meu Pluggy vêm todos com o conector "MeuPluggy": o banco sai do nome das contas.
export function bancoDoItem(item, contas = []) {
  const textos = [
    ...contas.filter((c) => c.type === 'BANK').flatMap((c) => [c.name, c.marketingName]),
    ...contas.flatMap((c) => [c.name, c.marketingName]),
    item?.connector?.name,
  ].filter(Boolean);
  for (const t of textos) for (const [re, nome] of BANCOS) if (re.test(t)) return nome;
  const nome = textos.find((t) => !/meu\s*pluggy/i.test(t)) || 'Banco';
  return nome.split(/\s+/)[0].replace(/^./, (c) => c.toUpperCase());
}

// Mesmo nome que os e-mails/faturas usam ("Nubank", "Itaú"), para agrupar e não duplicar.
export function nomeConta(conta, banco, { variosCartoes = false } = {}) {
  if (conta.type === 'CREDIT') return variosCartoes && conta.number ? `${banco} final ${String(conta.number).slice(-4)}` : banco;
  return `${banco} ${conta.subtype === 'SAVINGS_ACCOUNT' ? 'poupança' : 'conta'}`;
}

function vencimentoDe(tx, conta, faturasPorId) {
  const cm = tx.creditCardMetadata || {};
  const f = cm.billId && faturasPorId.get(cm.billId);
  if (f?.dueDate) return dia(f.dueDate);
  if (cm.billForecastDate) {
    const d = conta.creditData?.balanceDueDate ? dia(conta.creditData.balanceDueDate).slice(8, 10) : '10';
    return `${cm.billForecastDate.slice(0, 7)}-${d}`;
  }
  return null;
}

// Converte uma transação da Pluggy no formato do app; null quando ela não deve entrar.
export function mapTransacao(tx, conta, { nome, faturasPorId = new Map(), hoje = new Date().toISOString().slice(0, 10) } = {}) {
  const lancada = dia(tx.date);
  if (!lancada || lancada > hoje) return null; // parcelas futuras: a projeção já conta pelo X/Y
  const cm = tx.creditCardMetadata || {};
  const data = conta.type === 'CREDIT' ? dia(cm.purchaseDate) || lancada : lancada;
  const valor = Math.abs(Number(tx.amountInAccountCurrency ?? tx.amount));
  const sufixo = cm.totalInstallments ? new RegExp(`\\s*0*${cm.installmentNumber}\\s*/\\s*0*${cm.totalInstallments}\\s*$`) : null;
  const bruta = tx.merchant?.name || tx.description || tx.descriptionRaw || '';
  const descricao = (sufixo ? bruta.replace(sufixo, '') : bruta).trim();
  let tipo;
  if (conta.type === 'CREDIT') {
    if (!(Number(tx.amount) > 0)) return null; // pagamento da fatura ou estorno
    tipo = 'compra';
  } else {
    if (NAO_CONTA.test(`${tx.description} ${tx.descriptionRaw || ''}`) || CATEGORIAS_NAO_CONTA.test(tx.category || '')) return null;
    const pix = tx.operationType === 'PIX' || tx.paymentData?.paymentMethod === 'PIX' || /\bpix\b/i.test(tx.description || '');
    if (Number(tx.amount) < 0) tipo = pix ? 'pix_enviado' : 'debito';
    else if (pix) tipo = 'pix_recebido';
    else return null; // salários e outros créditos já estão em Receitas fixas
  }
  const t = normalizeTransacao(
    {
      data,
      valor,
      estabelecimento: descricao,
      conta_ou_cartao: nome,
      categoria: 'Outros',
      tipo,
      vencimento: tipo === 'compra' ? vencimentoDe(tx, conta, faturasPorId) : null,
      parcela_atual: cm.installmentNumber,
      parcelas_total: cm.totalInstallments,
    },
    { id: `pluggy:${tx.id}`, subject: 'Open Finance' },
  );
  if (!t) return null;
  t.dedupe_key = chave(tx.providerId || tx.id);
  return t;
}

export function mapFatura(f, nome) {
  const venc = dia(f.dueDate);
  const valor = Math.round(Number(f.totalAmount) * 100) / 100;
  if (!venc || !(valor > 0)) return null;
  const t = {
    data: venc,
    valor,
    estabelecimento: `Fatura ${nome}`,
    conta_ou_cartao: nome,
    categoria: 'Outros',
    tipo: 'fatura',
    vencimento: venc,
    parcela_atual: null,
    parcelas_total: null,
    origem_email_id: `pluggy:${f.id}`,
    origem_assunto: 'Open Finance',
  };
  t.dedupe_key = dedupeKey(t);
  return t;
}

// Estorno no cartão anula a compra de mesmo valor (ex.: "Estorno de Amazon Credito").
export function semEstornos(txs) {
  const estornos = txs.filter(
    (t) => Number(t.amount) < 0 && !/credit card payment/i.test(t.category || '') && !/pagamento recebido/i.test(t.description || ''),
  );
  const fora = new Set();
  for (const e of estornos) {
    const desc = String(e.description || '').toLowerCase();
    const alvo = txs.find(
      (t) =>
        !fora.has(t) &&
        Number(t.amount) > 0 &&
        Math.abs(Number(t.amount) + Number(e.amount)) < 0.005 &&
        desc.includes(String(t.description || '').toLowerCase().slice(0, 10)),
    );
    if (alvo) fora.add(alvo);
  }
  return txs.filter((t) => !fora.has(t));
}
