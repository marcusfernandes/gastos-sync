import { addMeses, faturasSemDetalhe, resumoMensal } from './forecast.js';

const round = (n) => Math.round(n * 100) / 100;
const mesDe = (d) => String(d).slice(0, 7);

// Série mensal para gráficos: entradas, saídas (registradas ou planejadas, o que for maior,
// mais faturas sem detalhe) e saídas por categoria.
export function serieMensal(transacoes, planejamento, ate, meses) {
  const semDetalhe = faturasSemDetalhe(transacoes);
  return Array.from({ length: meses }, (_, i) => addMeses(ate, i - meses + 1)).map((mes) => {
    const r = resumoMensal(transacoes, planejamento, mes);
    const planejados = r.gastos.fixos_planejados + r.gastos.pontuais_planejados;
    const usaPlanejado = planejados > r.gastos.registrados;
    const categorias = {};
    const somar = (cat, v) => (categorias[cat] = round((categorias[cat] || 0) + v));
    if (usaPlanejado) {
      for (const p of planejamento) {
        if (p.direcao !== 'saida') continue;
        const ini = mesDe(p.inicio);
        const fim = p.fim ? mesDe(p.fim) : null;
        const vale = p.recorrente ? ini <= mes && (!fim || mes <= fim) : ini === mes;
        if (vale) somar(p.categoria || 'Outros', p.valor);
      }
    } else {
      for (const [c, v] of Object.entries(r.gastos.por_categoria)) somar(c, v);
    }
    for (const f of semDetalhe) if (mesDe(f.vencimento || f.data) === mes) somar('Cartões (fatura)', f.valor);
    const saidas = round(Math.max(r.gastos.registrados, planejados) + r.gastos.faturas_sem_detalhe);
    return {
      mes,
      entradas: r.entradas.cadastradas,
      saidas,
      resultado: round(r.entradas.cadastradas - saidas),
      categorias,
    };
  });
}
