const GASTO_TIPOS = new Set(['compra', 'pix_enviado', 'debito', 'outro']);

const round = (n) => Math.round(n * 100) / 100;
const sum = (items) => round(items.reduce((acc, i) => acc + i.valor, 0));
const mesDe = (date) => String(date).slice(0, 7);
const cartaoDe = (t) => String(t.conta_ou_cartao || '').toLowerCase().split(/\s+/)[0];

// Faturas de cartões cujas compras não chegam detalhadas (ex.: só o total veio da planilha
// ou do e-mail) contam como gasto pelo valor total; as demais já entram compra a compra.
export function faturasSemDetalhe(transacoes) {
  const detalhados = new Set(
    transacoes
      .filter((t) => t.tipo === 'compra')
      .map((t) => `${cartaoDe(t)}|${t.vencimento ? mesDe(t.vencimento) : addMeses(mesDe(t.data), 1)}`),
  );
  return transacoes.filter((t) => t.tipo === 'fatura' && !detalhados.has(`${cartaoDe(t)}|${mesDe(t.vencimento || t.data)}`));
}

export function addMeses(mes, n) {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function planejadoNoMes(item, mes) {
  const inicio = mesDe(item.inicio);
  if (!item.recorrente) return inicio === mes;
  return inicio <= mes && (!item.fim || mesDe(item.fim) >= mes);
}

const parcelado = (t) => t.tipo === 'compra' && t.parcelas_total > 1;

// Mês em que a parcela foi cobrada: vencimento da fatura ou, sem ele, o mês seguinte à compra.
const mesCobranca = (t) => (t.vencimento ? mesDe(t.vencimento) : addMeses(mesDe(t.data), 1));

// Uma linha por compra parcelada (a parcela mais recente conhecida), com o mês da última parcela.
export function parcelamentos(transacoes) {
  const ultimas = new Map();
  for (const t of transacoes.filter(parcelado)) {
    const base = t.estabelecimento.replace(/\s*\(parcela\s*\d+\s*\/\s*\d+\)\s*/i, '').trim().replace(/[\s\-–:,]+$/, '');
    const chave = [t.conta_ou_cartao, base.toLowerCase(), t.valor.toFixed(2), t.parcelas_total].join('|');
    const atual = ultimas.get(chave);
    if (!atual || t.parcela_atual > atual.parcela_atual) ultimas.set(chave, { ...t, base });
  }
  return [...ultimas.values()]
    .map((t) => {
      const restantes = t.parcelas_total - t.parcela_atual;
      const cobrada = mesCobranca(t);
      return {
        id: t.id,
        estabelecimento: t.base,
        conta_ou_cartao: t.conta_ou_cartao,
        categoria: t.categoria,
        valor_parcela: t.valor,
        parcela_atual: t.parcela_atual,
        parcelas_total: t.parcelas_total,
        mes_cobranca: cobrada,
        mes_fim: addMeses(cobrada, restantes),
        restante: round(t.valor * restantes),
      };
    })
    .sort((a, b) => (a.mes_fim < b.mes_fim ? -1 : a.mes_fim > b.mes_fim ? 1 : b.valor_parcela - a.valor_parcela));
}

// Usado só para meses futuros: inclui o mês da parcela mais recente caso ele ainda não tenha chegado.
export function parcelasNoMes(lista, mes) {
  return lista.filter((p) => p.mes_cobranca <= mes && mes <= p.mes_fim);
}

function porCategoria(items) {
  const out = {};
  for (const i of items) out[i.categoria] = round((out[i.categoria] || 0) + i.valor);
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

// Compras de cartão contam no mês em que a fatura vence, como as faturas sem detalhe.
const mesPago = (t) => mesDe(t.vencimento || t.data);

export function resumoMensal(transacoes, planejamento, mes) {
  const gastos = transacoes.filter((t) => GASTO_TIPOS.has(t.tipo) && mesPago(t) === mes);
  const recebidos = transacoes.filter((t) => t.tipo === 'pix_recebido' && mesDe(t.data) === mes);
  const faturas = transacoes.filter((t) => t.tipo === 'fatura' && mesDe(t.vencimento || t.data) === mes);

  const plan = planejamento.filter((p) => planejadoNoMes(p, mes));
  const entradas = plan.filter((p) => p.direcao === 'entrada');
  const fixos = plan.filter((p) => p.direcao === 'saida' && p.recorrente);
  const pontuais = plan.filter((p) => p.direcao === 'saida' && !p.recorrente);

  const totalEntradas = sum(entradas);
  const totalFixos = sum(fixos);
  const totalPontuais = sum(pontuais);
  const totalGastos = sum(gastos);
  const semDetalhe = faturasSemDetalhe(transacoes).filter((t) => mesDe(t.vencimento || t.data) === mes);
  const totalSemDetalhe = sum(semDetalhe);

  return {
    mes,
    entradas: { cadastradas: totalEntradas, recebidas_pix: sum(recebidos) },
    gastos: {
      fixos_planejados: totalFixos,
      pontuais_planejados: totalPontuais,
      registrados: totalGastos,
      faturas_sem_detalhe: totalSemDetalhe,
      por_categoria: porCategoria(gastos),
    },
    faturas: {
      total_vencendo: sum(faturas),
      itens: faturas.map((f) => ({ conta: f.conta_ou_cartao, valor: f.valor, vencimento: f.vencimento })),
    },
    // "registrados" já inclui o que foi pago no mês (inclusive aluguel/contas via Pix);
    // os planejados entram só se ainda não houver registros suficientes.
    saldo_estimado: round(totalEntradas - Math.max(totalGastos, totalFixos + totalPontuais) - totalSemDetalhe),
  };
}


// Média mensal de gastos variáveis nos últimos N meses fechados, excluindo
// categorias cobertas por despesas fixas planejadas (evita contar o aluguel duas vezes).
export function mediaVariavel(transacoes, planejamento, mesAtual, nMeses) {
  const categoriasFixas = new Set(
    planejamento.filter((p) => p.direcao === 'saida' && p.recorrente).map((p) => p.categoria),
  );
  const meses = Array.from({ length: nMeses }, (_, i) => addMeses(mesAtual, -(i + 1)));
  const variaveis = transacoes.filter(
    (t) => GASTO_TIPOS.has(t.tipo) && !parcelado(t) && !categoriasFixas.has(t.categoria) && meses.includes(mesPago(t)),
  );
  const faturas = faturasSemDetalhe(transacoes).filter((t) => meses.includes(mesDe(t.vencimento || t.data)));
  const mesesComDados = new Set([...variaveis.map(mesPago), ...faturas.map((t) => mesDe(t.vencimento || t.data))]).size;
  return mesesComDados ? round((sum(variaveis) + sum(faturas) - parcelasEmFaturas(transacoes, faturas)) / mesesComDados) : 0;
}

// Faturas só com o total já incluem as parcelas daquele mês; como a projeção soma as parcelas
// conhecidas à parte, elas saem da média (limitado ao total das faturas sem detalhe do mês).
function parcelasEmFaturas(transacoes, faturas) {
  const detalhados = new Set(transacoes.filter((t) => t.tipo === 'compra').map((t) => `${cartaoDe(t)}|${mesPago(t)}`));
  const abertos = parcelamentos(transacoes);
  let total = 0;
  for (const mes of new Set(faturas.map((t) => mesDe(t.vencimento || t.data)))) {
    const parcelas = abertos
      .filter((p) => addMeses(p.mes_cobranca, 1 - p.parcela_atual) <= mes && mes <= p.mes_fim)
      .filter((p) => !detalhados.has(`${cartaoDe(p)}|${mes}`));
    total += Math.min(sum(faturas.filter((t) => mesDe(t.vencimento || t.data) === mes)), sum(parcelas.map((p) => ({ valor: p.valor_parcela }))));
  }
  return round(total);
}

export function projecao(transacoes, planejamento, { mesAtual, meses = 6, saldoInicial = 0, mesesHistorico = 3 }) {
  const variavel = mediaVariavel(transacoes, planejamento, mesAtual, mesesHistorico);
  const abertos = parcelamentos(transacoes);
  let saldo = saldoInicial;
  const linhas = [];
  for (let i = 1; i <= meses; i++) {
    const mes = addMeses(mesAtual, i);
    const plan = planejamento.filter((p) => planejadoNoMes(p, mes));
    const entradas = sum(plan.filter((p) => p.direcao === 'entrada'));
    const fixos = sum(plan.filter((p) => p.direcao === 'saida' && p.recorrente));
    const pontuais = plan.filter((p) => p.direcao === 'saida' && !p.recorrente);
    const parcelas = round(parcelasNoMes(abertos, mes).reduce((acc, p) => acc + p.valor_parcela, 0));
    const saidas = round(fixos + sum(pontuais) + variavel + parcelas);
    saldo = round(saldo + entradas - saidas);
    linhas.push({
      mes,
      entradas,
      gastos_fixos: fixos,
      gastos_variaveis_estimados: variavel,
      parcelas,
      gastos_pontuais: sum(pontuais),
      pontuais: pontuais.map((p) => ({ descricao: p.descricao, valor: p.valor })),
      resultado_mes: round(entradas - saidas),
      saldo_projetado: saldo,
    });
  }
  const menor = linhas.reduce((min, l) => (l.saldo_projetado < min.saldo_projetado ? l : min), linhas[0]);
  return {
    mes_base: mesAtual,
    saldo_inicial: saldoInicial,
    media_variavel_mensal: variavel,
    parcelamentos: abertos.filter((p) => p.mes_fim > mesAtual),
    meses: linhas,
    menor_saldo: menor ? { mes: menor.mes, valor: menor.saldo_projetado } : null,
    alerta: menor && menor.saldo_projetado < 0 ? `Saldo fica negativo em ${menor.mes}` : null,
  };
}
