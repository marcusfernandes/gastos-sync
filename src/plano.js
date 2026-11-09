import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { assinaturas, mediaPorCategoria } from './summary/analises.js';
import { projecao } from './summary/forecast.js';

let client;
const getClient = () => (client ??= new GoogleGenAI({ apiKey: config.gemini.apiKey }));
const round = (n) => Math.round(n * 100) / 100;

const INSTRUCOES = `Você é o planejador financeiro do gastos-sync (casal Marcus e Becca). Com base nos DADOS (R$),
proponha um plano de corte de gastos para o saldo projetado não ficar negativo e, se possível, sobrar uma folga.
- Use só os dados; não invente gastos. Seja específico (categoria, estabelecimento, assinatura, valor por mês).
- Prefira cortes realistas em gastos variáveis e assinaturas; não sugira cortar moradia, saúde essencial ou parcelas já contratadas.
- "economia_mensal" é quanto a ação reduz por mês, em reais. Para ações de meta por categoria, use tipo "orcamento" e a categoria exata da lista.
- Mire em "economia_necessaria_mensal" (já calculada para o menor saldo ficar ≥ 0) com uma folga de até 30%; não proponha cortes muito maiores que isso.
- Cada corte em categoria deve ser realista: no máximo 30% do gasto típico dela (veja o mês atual e a média).
- Entre 3 e 6 ações, ordenadas pelo impacto. Texto curto em português do Brasil.`;

const schema = (categorias) => ({
  type: 'object',
  properties: {
    resumo: { type: 'string' },
    acoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          detalhe: { type: 'string' },
          tipo: { type: 'string', enum: ['orcamento', 'cancelar', 'renegociar', 'adiar', 'outro'] },
          categoria: { type: 'string', enum: [...categorias, ''] },
          economia_mensal: { type: 'number' },
        },
        required: ['titulo', 'detalhe', 'tipo', 'categoria', 'economia_mensal'],
      },
    },
  },
  required: ['resumo', 'acoes'],
});

export function dadosDoPlano({ transacoes, planejamento, mesAtual, saldoAtual, limites = {}, meses = 6 }) {
  const proj = projecao(transacoes, planejamento, { mesAtual, meses, saldoInicial: saldoAtual, mesesHistorico: config.summary.mesesHistoricoVariavel });
  const atual = {};
  for (const t of transacoes) {
    if (!['compra', 'pix_enviado', 'debito', 'outro'].includes(t.tipo) || String(t.vencimento || t.data).slice(0, 7) !== mesAtual) continue;
    atual[t.categoria] = round((atual[t.categoria] || 0) + t.valor);
  }
  return {
    proj,
    contexto: {
      mes_atual: mesAtual,
      economia_necessaria_mensal: economiaNecessaria(proj),
      saldo_atual: saldoAtual,
      projecao: proj.meses.map(({ pontuais, ...m }) => m),
      menor_saldo: proj.menor_saldo,
      gastos_por_categoria_mes_atual: atual,
      media_por_categoria_3_meses: mediaPorCategoria(transacoes, mesAtual),
      metas_atuais: limites,
      assinaturas: assinaturas(transacoes, mesAtual).itens.map((a) => ({ nome: a.estabelecimento, valor: a.valor, categoria: a.categoria })),
      parcelamentos_em_aberto: proj.parcelamentos.map((p) => ({ compra: p.estabelecimento, parcela: p.valor_parcela, termina: p.mes_fim })),
      fixos: planejamento.filter((p) => p.direcao === 'saida' && p.recorrente && !p.fim).map((p) => ({ descricao: p.descricao, valor: p.valor })),
    },
  };
}

// Menor corte mensal (a partir do 1º mês projetado) que deixa todos os saldos ≥ 0.
export function economiaNecessaria(proj) {
  return round(Math.max(0, ...proj.meses.map((m, i) => -m.saldo_projetado / (i + 1))));
}

// Saldo projetado mês a mês aplicando a economia mensal a partir do mês seguinte.
export function comEconomia(proj, economia) {
  return proj.meses.map((m, i) => ({ mes: m.mes, sem_plano: m.saldo_projetado, com_plano: round(m.saldo_projetado + economia * (i + 1)) }));
}

export async function gerarPlano({ categorias, ai = getClient(), ...dados }) {
  const { proj, contexto } = dadosDoPlano(dados);
  const { model, fallbackModel } = config.gemini;
  const gerar = (m) =>
    ai.models.generateContent({
      model: m,
      contents: [{ role: 'user', parts: [{ text: `${INSTRUCOES}\n\nDADOS (JSON):\n${JSON.stringify(contexto)}` }] }],
      config: { temperature: 0.2, responseMimeType: 'application/json', responseJsonSchema: schema(categorias) },
    });
  let r;
  try {
    r = await gerar(model);
  } catch (err) {
    if (!fallbackModel || fallbackModel === model || ![500, 503, 404].includes(err?.status ?? err?.code)) throw err;
    r = await gerar(fallbackModel);
  }
  const plano = JSON.parse(r.text || '{}');
  const acoes = (plano.acoes || [])
    .map((a) => ({ ...a, categoria: a.categoria || null, economia_mensal: round(Math.max(0, Number(a.economia_mensal) || 0)) }))
    .filter((a) => a.titulo);
  const economia = round(acoes.reduce((s, a) => s + a.economia_mensal, 0));
  return {
    gerado_em: new Date().toISOString(),
    mes: dados.mesAtual,
    resumo: plano.resumo || '',
    acoes,
    economia_mensal: economia,
    menor_saldo: proj.menor_saldo,
    economia_necessaria: economiaNecessaria(proj),
    saldos: comEconomia(proj, economia),
  };
}
