const GASTO_TIPOS = new Set(['compra', 'pix_enviado', 'debito', 'outro']);

const round = (n) => Math.round(n * 100) / 100;
const sum = (items) => round(items.reduce((acc, i) => acc + i.valor, 0));
const mesDe = (date) => String(date).slice(0, 7);

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

function porCategoria(items) {
  const out = {};
  for (const i of items) out[i.categoria] = round((out[i.categoria] || 0) + i.valor);
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

export function resumoMensal(transacoes, planejamento, mes) {
  const doMes = transacoes.filter((t) => mesDe(t.data) === mes);
  const gastos = doMes.filter((t) => GASTO_TIPOS.has(t.tipo));
  const recebidos = doMes.filter((t) => t.tipo === 'pix_recebido');
  const faturas = transacoes.filter((t) => t.tipo === 'fatura' && mesDe(t.vencimento || t.data) === mes);

  const plan = planejamento.filter((p) => planejadoNoMes(p, mes));
  const entradas = plan.filter((p) => p.direcao === 'entrada');
  const fixos = plan.filter((p) => p.direcao === 'saida' && p.recorrente);
  const pontuais = plan.filter((p) => p.direcao === 'saida' && !p.recorrente);

  const totalEntradas = sum(entradas);
  const totalFixos = sum(fixos);
  const totalPontuais = sum(pontuais);
  const totalGastos = sum(gastos);

  return {
    mes,
    entradas: { cadastradas: totalEntradas, recebidas_pix: sum(recebidos) },
    gastos: {
      fixos_planejados: totalFixos,
      pontuais_planejados: totalPontuais,
      registrados: totalGastos,
      por_categoria: porCategoria(gastos),
    },
    faturas: {
      total_vencendo: sum(faturas),
      itens: faturas.map((f) => ({ conta: f.conta_ou_cartao, valor: f.valor, vencimento: f.vencimento })),
    },
    // "registrados" já inclui o que foi pago no mês (inclusive aluguel/contas via Pix);
    // os planejados entram só se ainda não houver registros suficientes.
    saldo_estimado: round(totalEntradas - Math.max(totalGastos, totalFixos + totalPontuais)),
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
    (t) => GASTO_TIPOS.has(t.tipo) && !categoriasFixas.has(t.categoria) && meses.includes(mesDe(t.data)),
  );
  const mesesComDados = new Set(variaveis.map((t) => mesDe(t.data))).size;
  return mesesComDados ? round(sum(variaveis) / mesesComDados) : 0;
}

export function projecao(transacoes, planejamento, { mesAtual, meses = 6, saldoInicial = 0, mesesHistorico = 3 }) {
  const variavel = mediaVariavel(transacoes, planejamento, mesAtual, mesesHistorico);
  let saldo = saldoInicial;
  const linhas = [];
  for (let i = 1; i <= meses; i++) {
    const mes = addMeses(mesAtual, i);
    const plan = planejamento.filter((p) => planejadoNoMes(p, mes));
    const entradas = sum(plan.filter((p) => p.direcao === 'entrada'));
    const fixos = sum(plan.filter((p) => p.direcao === 'saida' && p.recorrente));
    const pontuais = plan.filter((p) => p.direcao === 'saida' && !p.recorrente);
    const saidas = round(fixos + sum(pontuais) + variavel);
    saldo = round(saldo + entradas - saidas);
    linhas.push({
      mes,
      entradas,
      gastos_fixos: fixos,
      gastos_variaveis_estimados: variavel,
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
    meses: linhas,
    menor_saldo: menor ? { mes: menor.mes, valor: menor.saldo_projetado } : null,
    alerta: menor && menor.saldo_projetado < 0 ? `Saldo fica negativo em ${menor.mes}` : null,
  };
}
