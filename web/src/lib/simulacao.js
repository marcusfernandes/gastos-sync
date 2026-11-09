const add = (mes, n) => {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const r2 = (n) => Math.round(n * 100) / 100;

export function custoNoMes({ valor, parcelas = 1, entrada = 0, inicio }, mes) {
  const n = Math.max(1, Math.trunc(parcelas));
  const parcela = (valor - entrada) / n;
  let custo = 0;
  if (mes === inicio) custo += entrada;
  if (mes >= inicio && mes <= add(inicio, n - 1)) custo += parcela;
  return r2(custo);
}

// Aplica uma compra hipotética sobre os meses da projeção ({ mes, saldo_projetado, resultado_mes }).
export function simular(meses, compra) {
  let acumulado = 0;
  const linhas = meses.map((m) => {
    const custo = custoNoMes(compra, m.mes);
    acumulado += custo;
    return { ...m, custo, resultado_com: r2(m.resultado_mes - custo), saldo_com: r2(m.saldo_projetado - acumulado) };
  });
  const menor = (k) => linhas.reduce((min, l) => (l[k] < min[k] ? l : min), linhas[0]);
  const a = menor('saldo_projetado');
  const d = menor('saldo_com');
  return {
    linhas,
    menor_antes: a && { mes: a.mes, valor: a.saldo_projetado },
    menor_depois: d && { mes: d.mes, valor: d.saldo_com },
    primeiro_negativo: linhas.find((l) => l.saldo_com < 0)?.mes ?? null,
  };
}

// Primeiro mês de início em que o saldo nunca fica abaixo da margem; senão, o que deixa o maior saldo mínimo.
export function melhorInicio(meses, compra, { candidatos = 12, margem = 0 } = {}) {
  if (!meses.length) return null;
  const opcoes = [];
  for (let i = 0; i < Math.min(candidatos, meses.length); i++) {
    const inicio = meses[i].mes;
    opcoes.push({ inicio, menor: simular(meses, { ...compra, inicio }).menor_depois.valor });
  }
  return opcoes.find((o) => o.menor >= margem) ?? opcoes.reduce((b, o) => (o.menor > b.menor ? o : b));
}
