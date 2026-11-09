import { GASTO_TIPOS, faturasSemDetalhe, mesPago, planejadoNoMes } from './forecast.js';

export const CASAL = 'Casal';
const round = (n) => Math.round(n * 100) / 100;
const mesDe = (d) => String(d).slice(0, 7);

export const pessoasDe = (planejamento) =>
  [...new Set(planejamento.filter((p) => p.direcao === 'entrada' && p.responsavel).map((p) => p.responsavel))].sort();

// Gastos do mês por pessoa (sem responsável = casal) e quanto cabe a cada um do que é do casal.
export function gastosPorPessoa(transacoes, planejamento, mes) {
  const pessoas = pessoasDe(planejamento);
  const doMes = [
    ...transacoes.filter((t) => GASTO_TIPOS.has(t.tipo) && mesPago(t) === mes),
    ...faturasSemDetalhe(transacoes).filter((t) => mesDe(t.vencimento || t.data) === mes),
  ];
  const grupos = new Map([...pessoas, CASAL].map((p) => [p, { pessoa: p, total: 0, lancamentos: 0, por_categoria: {} }]));
  for (const t of doMes) {
    const g = grupos.get(pessoas.includes(t.responsavel) ? t.responsavel : CASAL);
    g.total = round(g.total + t.valor);
    g.lancamentos++;
    g.por_categoria[t.categoria] = round((g.por_categoria[t.categoria] || 0) + t.valor);
  }
  const renda = Object.fromEntries(pessoas.map((p) => [p, round(planejamento
    .filter((x) => x.direcao === 'entrada' && x.responsavel === p && planejadoNoMes(x, mes))
    .reduce((a, x) => a + x.valor, 0))]));
  const rendaTotal = Object.values(renda).reduce((a, v) => a + v, 0);
  const casal = grupos.get(CASAL).total;
  const divisao = pessoas.map((p) => {
    const parte = rendaTotal ? renda[p] / rendaTotal : 1 / pessoas.length;
    const proprio = grupos.get(p).total;
    return {
      pessoa: p,
      renda: renda[p],
      proprio,
      casal_meio_a_meio: round(casal / pessoas.length),
      casal_proporcional: round(casal * parte),
      percentual_renda: round(parte),
      total_meio_a_meio: round(proprio + casal / pessoas.length),
      total_proporcional: round(proprio + casal * parte),
    };
  });
  return { mes, pessoas, grupos: [...grupos.values()], divisao };
}
