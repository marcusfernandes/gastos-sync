import { addMeses, projecao, resumoMensal } from './forecast.js';
import { assinaturas, conferencia } from './analises.js';
import { lerMetas, resumoMetas } from './metas.js';

const SEM_DETALHE = 'Faturas sem detalhe';
const round = (n) => Math.round(n * 100) / 100;
const saidas = (r) => round(Math.max(r.gastos.registrados, r.gastos.fixos_planejados + r.gastos.pontuais_planejados) + (r.gastos.faturas_sem_detalhe || 0));

// Balanço de um mês fechado, comparado com o anterior, e como fica a projeção dali para frente.
export function fechamento({ transacoes, planejamento, mes, saldoAtual = 0, metas = [], mesesHistorico = 3 }) {
  const r = resumoMensal(transacoes, planejamento, mes);
  const a = resumoMensal(transacoes, planejamento, addMeses(mes, -1));
  const porCat = (x) => ({ ...x.gastos.por_categoria, ...(x.gastos.faturas_sem_detalhe ? { [SEM_DETALHE]: x.gastos.faturas_sem_detalhe } : {}) });
  const [pr, pa] = [porCat(r), porCat(a)];
  const cats = new Set([...Object.keys(pr), ...Object.keys(pa)]);
  const categorias = [...cats]
    .map((c) => {
      const atual = pr[c] || 0;
      const anterior = pa[c] || 0;
      return { categoria: c, atual, anterior, diferenca: round(atual - anterior) };
    })
    .sort((x, y) => y.atual - x.atual);
  const mudancas = categorias.filter((c) => Math.abs(c.diferenca) >= 50).sort((x, y) => Math.abs(y.diferenca) - Math.abs(x.diferenca));
  const proj = projecao(transacoes, planejamento, { mesAtual: mes, meses: 6, saldoInicial: saldoAtual, mesesHistorico, metas });
  const conf = conferencia(transacoes, mes);
  const assin = assinaturas(transacoes, mes);
  const entradas = round(r.entradas.cadastradas + r.entradas.recebidas_pix);
  const entradasAnt = round(a.entradas.cadastradas + a.entradas.recebidas_pix);
  return {
    mes,
    entradas,
    saidas: saidas(r),
    resultado: round(entradas - saidas(r)),
    anterior: { mes: a.mes, entradas: entradasAnt, saidas: saidas(a), resultado: round(entradasAnt - saidas(a)) },
    categorias,
    altas: mudancas.filter((c) => c.diferenca > 0).slice(0, 4),
    quedas: mudancas.filter((c) => c.diferenca < 0).slice(0, 4),
    assinaturas: { total_mensal: assin.total_mensal, novas: assin.itens.filter((i) => i.nova).map((i) => i.estabelecimento), aumentos: assin.itens.filter((i) => i.aumento).map((i) => i.estabelecimento) },
    faturas_divergentes: conf.faturas.filter((f) => !f.confere),
    possiveis_repetidas: conf.duplicadas.length,
    projecao: { saldo_inicial: saldoAtual, menor_saldo: proj.menor_saldo, meses: proj.meses.map((m) => ({ mes: m.mes, saldo_projetado: m.saldo_projetado })) },
    metas: resumoMetas(metas, mes),
  };
}

export function textoFechamento(f, { brl, mesBR }) {
  const sinal = (n) => `${n > 0 ? '+' : ''}${brl(n)}`;
  const linhas = [
    `📅 Fechamento de ${mesBR(f.mes)}`,
    `Entradas: ${brl(f.entradas)}`,
    `Saídas: ${brl(f.saidas)} (${sinal(round(f.saidas - f.anterior.saidas))} vs ${mesBR(f.anterior.mes)})`,
    `Resultado: ${brl(f.resultado)} (em ${mesBR(f.anterior.mes)}: ${brl(f.anterior.resultado)})`,
  ];
  if (f.categorias.length) linhas.push('', 'Onde mais foi:', ...f.categorias.slice(0, 5).map((c) => `• ${c.categoria}: ${brl(c.atual)}`));
  if (f.altas.length) linhas.push('', 'Subiu:', ...f.altas.map((c) => `🔺 ${c.categoria}: ${sinal(c.diferenca)}`));
  if (f.quedas.length) linhas.push('', 'Caiu:', ...f.quedas.map((c) => `🔻 ${c.categoria}: ${sinal(c.diferenca)}`));
  linhas.push('', `Assinaturas: ${brl(f.assinaturas.total_mensal)}/mês${f.assinaturas.novas.length ? ` · novas: ${f.assinaturas.novas.join(', ')}` : ''}`);
  for (const d of f.faturas_divergentes) linhas.push(`⚠️ Fatura ${d.conta_ou_cartao} não bate: diferença de ${brl(d.diferenca)}`);
  if (f.possiveis_repetidas) linhas.push(`⚠️ ${f.possiveis_repetidas} possível(is) compra(s) repetida(s) — veja /revisar`);
  const m = f.projecao.menor_saldo;
  if (m) linhas.push('', m.valor < 0 ? `📉 Projeção: o saldo fica negativo e chega a ${brl(m.valor)} em ${mesBR(m.mes)}.` : `📈 Projeção: saldo positivo nos próximos 6 meses (menor: ${brl(m.valor)} em ${mesBR(m.mes)}).`);
  if (f.metas.itens.length) linhas.push(`🐷 Metas: guardar ${brl(f.metas.aporte_total)}/mês (${f.metas.itens.map((i) => `${i.nome} ${Math.round(i.progresso * 100)}%`).join(', ')})`);
  return linhas.join('\n');
}

export async function gerarFechamento(storage, mes) {
  const [transacoes, planejamento, saldo, metas] = await Promise.all([
    storage.listTransacoes({ desde: `${addMeses(mes, -7)}-01` }),
    storage.listPlanejamento(),
    storage.getConfig ? storage.getConfig('saldo_atual') : null,
    lerMetas(storage),
  ]);
  return fechamento({ transacoes, planejamento, mes, saldoAtual: JSON.parse(saldo || 'null')?.valor ?? 0, metas });
}
