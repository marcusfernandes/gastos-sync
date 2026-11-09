import { createHash } from 'node:crypto';
import { dedupeKey, normalizarTexto, normalizeTransacao } from '../parser/normalize.js';

const dia = (d) => (d ? String(d).slice(0, 10) : null);
const chave = (s) => createHash('sha256').update(`pluggy|${s}`).digest('hex');

// Movimentações da conta que não são gasto/receita do mês: pagamento de fatura (as compras
// já entram pelo cartão), aplicações/resgates e transferências entre contas próprias.
const NAO_CONTA =
  /fatura|pagto\.?\s*cart|gastos\s*cart|pag(amento|to)?\s*(de\s*)?cart[aã]o|aplica[cç][aã]o|resgate|rende\s*f[aá]cil|invest|poupan[cç]a|cdb|tesouro|transf.*mesma\s*titularidade/i;
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

// Cartões que dividem o banco com outro da casa: o nome leva o produto, como nos e-mails.
const PRODUTOS = [
  ['Bradesco', /infinite/i, 'Visa Infinite'],
  ['Bradesco', /nanquim/i, 'Nanquim'],
];
const primeiroNome = (s) => String(s || '').trim().split(/\s+/)[0].toLowerCase().replace(/^./, (c) => c.toUpperCase());

// Mesmo nome que os e-mails/faturas usam ("Nubank", "Itaú"), para agrupar e não duplicar.
// `outroTitular`: contas de quem não é o titular principal levam o primeiro nome dele.
export function nomeConta(conta, banco, { variosCartoes = false, outroTitular = false } = {}) {
  if (conta.type === 'CREDIT') {
    const produto = PRODUTOS.find(([b, re]) => b === banco && re.test(`${conta.name} ${conta.marketingName || ''}`));
    if (produto) return `${banco} ${produto[2]}`;
    return variosCartoes && conta.number ? `${banco} final ${String(conta.number).slice(-4)}` : banco;
  }
  const nome = `${banco} ${conta.subtype === 'SAVINGS_ACCOUNT' ? 'poupança' : 'conta'}`;
  return outroTitular && conta.owner ? `${nome} ${primeiroNome(conta.owner)}` : nome;
}

// Titular mais frequente entre as contas conectadas (os demais são "outro titular").
export function titularPrincipal(contas) {
  const n = new Map();
  for (const c of contas) if (c.owner) n.set(primeiroNome(c.owner), (n.get(primeiroNome(c.owner)) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}
export const titularDe = (conta) => primeiroNome(conta.owner);

// "MARCUS VINICIUS FERNANDES" → "marcus vinicius": os extratos cortam o nome no meio.
export const nomesDosTitulares = (contas) =>
  [...new Set(contas.map((c) => normalizarTexto(c.owner).split(' ').slice(0, 2).join(' ')).filter((n) => n.includes(' ')))];

const somaMeses = (mes, n) => {
  const d = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const difMeses = (a, b) => (+a.slice(0, 4) - +b.slice(0, 4)) * 12 + (+a.slice(5, 7) - +b.slice(5, 7));

// Cada banco usa `billForecastDate` de um jeito (mês do vencimento ou do fechamento): descobre
// pelas compras já faturadas quantos meses separam a previsão do vencimento real.
export function deslocamentoPrevisao(txs, faturasPorId) {
  const n = new Map();
  for (const tx of txs) {
    const cm = tx.creditCardMetadata || {};
    const f = cm.billId && faturasPorId.get(cm.billId);
    if (!f?.dueDate || !cm.billForecastDate) continue;
    const d = difMeses(dia(f.dueDate), cm.billForecastDate);
    n.set(d, (n.get(d) || 0) + 1);
  }
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
}

function vencimentoDe(tx, conta, faturasPorId, deslocamento = 0) {
  const cm = tx.creditCardMetadata || {};
  const f = cm.billId && faturasPorId.get(cm.billId);
  if (f?.dueDate) return dia(f.dueDate);
  if (cm.billForecastDate) {
    const d = conta.creditData?.balanceDueDate ? dia(conta.creditData.balanceDueDate).slice(8, 10) : '10';
    return `${somaMeses(cm.billForecastDate.slice(0, 7), deslocamento)}-${d}`;
  }
  return null;
}

// Converte uma transação da Pluggy no formato do app; null quando ela não deve entrar.
export function mapTransacao(tx, conta, { nome, faturasPorId = new Map(), deslocamento = 0, titulares = [], hoje = new Date().toISOString().slice(0, 10) } = {}) {
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
    const pd = tx.paymentData || {};
    const envolvidos = normalizarTexto(`${tx.description} ${tx.descriptionRaw || ''} ${pd.payer?.name || ''} ${pd.receiver?.name || ''}`);
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
      vencimento: tipo === 'compra' ? vencimentoDe(tx, conta, faturasPorId, deslocamento) : null,
      parcela_atual: cm.installmentNumber,
      parcelas_total: cm.totalInstallments,
    },
    { id: `pluggy:${tx.id}`, subject: 'Open Finance' },
  );
  if (!t) return null;
  t.dedupe_key = chave(tx.providerId || tx.id);
  if (conta.type !== 'CREDIT') {
    const pd = tx.paymentData || {};
    const envolvidos = normalizarTexto(`${tx.description} ${tx.descriptionRaw || ''} ${pd.payer?.name || ''} ${pd.receiver?.name || ''}`);
    // Pix entre o casal: dinheiro que só muda de conta. Marcado (não descartado) para casar a outra ponta.
    if (titulares.some((n) => envolvidos.includes(n))) t.entre_titulares = true;
  }
  if (cm.billId) t.fatura_id = cm.billId;
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

// Pix devolvido na mesma conta (ex.: pagamento recusado e estornado): os dois lados se anulam.
export function semDevolucoes(txs) {
  const fora = new Set();
  for (const d of txs.filter((t) => Number(t.amount) > 0 && /devolu/i.test(t.description || ''))) {
    const ida = txs.find(
      (t) => !fora.has(t) && Number(t.amount) < 0 && Math.abs(Number(t.amount) + Number(d.amount)) < 0.005 && Math.abs(Date.parse(t.date) - Date.parse(d.date)) <= 5 * 864e5,
    );
    if (ida) fora.add(ida).add(d);
  }
  return txs.filter((t) => !fora.has(t));
}

// Fatura cujas compras não vieram todas (ex.: parcelas antigas fora da janela da API): melhor manter
// o total da fatura do que trocar por um detalhe que soma menos.
export function faturasIncompletas(linhas, faturas) {
  const soma = new Map();
  for (const t of linhas) if (t.fatura_id) soma.set(t.fatura_id, (soma.get(t.fatura_id) || 0) + t.valor);
  return new Set(
    faturas
      .filter((f) => soma.has(f.id) && soma.get(f.id) < Number(f.totalAmount) - Math.max(5, Number(f.totalAmount) * 0.02))
      .map((f) => f.id),
  );
}
