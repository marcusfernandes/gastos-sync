import { chaveEstabelecimento } from '../parser/normalize.js';
import { GASTO_TIPOS, addMeses, mesPago, parcelado } from './forecast.js';

const round = (n) => Math.round(n * 100) / 100;
const mesDe = (d) => String(d).slice(0, 7);
const cartaoDe = (t) => String(t.conta_ou_cartao || '').toLowerCase().split(/\s+/)[0];
const gastos = (transacoes) => transacoes.filter((t) => GASTO_TIPOS.has(t.tipo));
const mediana = (v) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const DIA_MS = 86400000;

function totaisPorCategoria(transacoes, mes) {
  const out = {};
  for (const t of gastos(transacoes)) if (mesPago(t) === mes) out[t.categoria] = round((out[t.categoria] || 0) + t.valor);
  return out;
}

// Média dos últimos N meses (que têm algum gasto) por categoria: ponto de partida para as metas.
export function mediaPorCategoria(transacoes, mes, n = 3) {
  const meses = Array.from({ length: n }, (_, i) => addMeses(mes, -(i + 1)));
  const porMes = meses.map((m) => totaisPorCategoria(transacoes, m)).filter((x) => Object.keys(x).length);
  const out = {};
  for (const m of porMes) for (const [c, v] of Object.entries(m)) out[c] = (out[c] || 0) + v;
  return Object.fromEntries(Object.entries(out).map(([c, v]) => [c, round(v / (porMes.length || 1))]));
}

export function nivelOrcamento(gasto, limite) {
  if (!(limite > 0)) return null;
  const p = gasto / limite;
  return p >= 1 ? 'estourou' : p >= 0.8 ? 'alerta' : 'ok';
}

// Gasto do mês por categoria comparado com a meta (compras de cartão contam no mês da fatura).
export function orcamentoDoMes(transacoes, mes, limites = {}) {
  const gasto = totaisPorCategoria(transacoes, mes);
  const media = mediaPorCategoria(transacoes, mes);
  const cats = new Set([...Object.keys(gasto), ...Object.keys(limites)]);
  const itens = [...cats]
    .map((categoria) => {
      const g = gasto[categoria] || 0;
      const limite = limites[categoria] ?? null;
      return {
        categoria,
        gasto: g,
        limite,
        media: media[categoria] ?? 0,
        percentual: limite ? round(g / limite) : null,
        nivel: nivelOrcamento(g, limite),
        restante: limite ? round(limite - g) : null,
      };
    })
    .sort((a, b) => b.gasto - a.gasto || (b.limite || 0) - (a.limite || 0));
  const comMeta = itens.filter((i) => i.limite);
  return {
    mes,
    itens,
    total_gasto: round(itens.reduce((s, i) => s + i.gasto, 0)),
    total_limite: round(comMeta.reduce((s, i) => s + i.limite, 0)),
    gasto_com_meta: round(comMeta.reduce((s, i) => s + i.gasto, 0)),
  };
}

// Cobranças que se repetem todo mês com valor parecido (streaming, apps, academia...).
export function assinaturas(transacoes, mesAtual, { meses = 6 } = {}) {
  const desde = addMeses(mesAtual, -(meses - 1));
  const grupos = new Map();
  for (const t of gastos(transacoes)) {
    if (parcelado(t) || mesDe(t.data) < desde || mesDe(t.data) > mesAtual) continue;
    const k = chaveEstabelecimento(t.estabelecimento);
    if (!k || /^(iof|juros|multa|encargos)\b/.test(k)) continue;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(t);
  }
  const lista = [];
  for (const txs of grupos.values()) {
    txs.sort((a, b) => (a.data < b.data ? -1 : 1));
    const mesesCom = [...new Set(txs.map((t) => mesDe(t.data)))];
    const ultima = txs.at(-1);
    const daCategoria = txs.some((t) => t.categoria === 'Assinaturas');
    if (mesAtual > addMeses(mesDe(ultima.data), 1)) continue;
    if (txs.length > mesesCom.length * 1.5) continue;
    const med = mediana(txs.map((t) => t.valor));
    const parecidos = txs.filter((t) => Math.abs(t.valor - med) <= Math.max(2, med * 0.25)).length;
    const recorrente = mesesCom.length >= 3 || (daCategoria && mesesCom.length >= 2);
    if (recorrente && parecidos / txs.length < 0.7) continue;
    if (!recorrente && !(daCategoria && mesesCom.length === 1 && mesDe(ultima.data) >= addMeses(mesAtual, -1))) continue;
    const anterior = [...txs].reverse().find((t) => mesDe(t.data) < mesDe(ultima.data));
    const aumento = anterior && ultima.valor - anterior.valor > Math.max(1, anterior.valor * 0.02) ? round(ultima.valor - anterior.valor) : 0;
    lista.push({
      estabelecimento: ultima.estabelecimento,
      chave: chaveEstabelecimento(ultima.estabelecimento),
      categoria: ultima.categoria,
      conta_ou_cartao: ultima.conta_ou_cartao,
      valor: ultima.valor,
      valor_anterior: anterior?.valor ?? null,
      aumento,
      meses: mesesCom.length,
      ultima_data: ultima.data,
      nova: !recorrente,
    });
  }
  lista.sort((a, b) => b.valor - a.valor);
  return { itens: lista, total_mensal: round(lista.reduce((s, a) => s + a.valor, 0)) };
}

const primeiraPalavra = (t) => chaveEstabelecimento(t.estabelecimento).split(' ')[0] || '';

// Confere as faturas do mês: total do banco × soma das compras, compras repetidas e gastos fora do padrão.
export function conferencia(transacoes, mes) {
  const doMes = gastos(transacoes).filter((t) => mesPago(t) === mes);

  const faturas = [];
  const porCartao = new Map();
  for (const t of transacoes) {
    if (!['compra', 'fatura'].includes(t.tipo) || mesDe(t.vencimento || t.data) !== mes) continue;
    const k = cartaoDe(t);
    if (!porCartao.has(k)) porCartao.set(k, { faturas: [], compras: [] });
    porCartao.get(k)[t.tipo === 'fatura' ? 'faturas' : 'compras'].push(t);
  }
  for (const { faturas: fs, compras } of porCartao.values()) {
    const fatura = fs.sort((a, b) => b.valor - a.valor)[0];
    if (!fatura || !compras.length) continue;
    const soma = round(compras.reduce((s, t) => s + t.valor, 0));
    const diferenca = round(fatura.valor - soma);
    faturas.push({
      conta_ou_cartao: fatura.conta_ou_cartao,
      vencimento: fatura.vencimento,
      total_fatura: fatura.valor,
      soma_compras: soma,
      compras: compras.length,
      diferenca,
      confere: Math.abs(diferenca) <= 1,
    });
  }

  const duplicadas = [];
  const usados = new Set();
  for (let i = 0; i < doMes.length; i++) {
    for (let j = i + 1; j < doMes.length; j++) {
      const a = doMes[i];
      const b = doMes[j];
      if (usados.has(b.id) || a.valor !== b.valor || cartaoDe(a) !== cartaoDe(b) || primeiraPalavra(a) !== primeiraPalavra(b)) continue;
      if ((a.parcela_atual || 0) !== (b.parcela_atual || 0)) continue;
      if (Math.abs(Date.parse(a.data) - Date.parse(b.data)) > 2 * DIA_MS) continue;
      duplicadas.push([a, b]);
      usados.add(b.id);
    }
  }

  const historico = gastos(transacoes).filter((t) => !parcelado(t) && mesPago(t) < mes && mesPago(t) >= addMeses(mes, -6));
  const foraDoPadrao = doMes
    .filter((t) => !parcelado(t) && t.valor >= 200)
    .map((t) => {
      const valores = historico.filter((h) => h.categoria === t.categoria).map((h) => h.valor);
      const med = valores.length >= 5 ? mediana(valores) : null;
      return med && t.valor >= med * 4 ? { ...t, mediana_categoria: round(med), vezes: round(t.valor / med) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.valor - a.valor);

  return { mes, faturas, duplicadas, fora_do_padrao: foraDoPadrao };
}

// Fila do que entrou no mês e merece um olho: categoria "Outros", possíveis repetidas e valores altos.
export function caixaRevisao(transacoes, mes, revisados = new Set()) {
  const conf = conferencia(transacoes, mes);
  const itens = [];
  const vistos = new Set();
  const add = (t, tipo, motivo, extra = {}) => {
    if (revisados.has(String(t.id)) || vistos.has(t.id)) return;
    vistos.add(t.id);
    itens.push({ tipo, motivo, transacao: t, ...extra });
  };
  for (const [x, y] of conf.duplicadas) add(y, 'repetida', `Parece repetir ${x.estabelecimento} de ${x.data.split('-').reverse().join('/')}`, { par: x });
  for (const t of conf.fora_do_padrao) add(t, 'alto', `${t.vezes}× o gasto típico de ${t.categoria}`);
  for (const t of gastos(transacoes).filter((t) => mesPago(t) === mes)) {
    if (t.categoria === 'Outros') add(t, 'outros', 'Sem categoria definida');
    else if (t.valor >= 1000 && !parcelado(t)) add(t, 'alto', 'Valor alto');
  }
  const ordem = { repetida: 0, alto: 1, outros: 2 };
  return itens.sort((a, b) => ordem[a.tipo] - ordem[b.tipo] || b.transacao.valor - a.transacao.valor);
}
