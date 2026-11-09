import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { addMeses, projecao } from './summary/forecast.js';
import { serieMensal } from './summary/historico.js';

let client;
const getClient = () => (client ??= new GoogleGenAI({ apiKey: config.gemini.apiKey }));
const mesDe = (d) => String(d).slice(0, 7);
const round = (n) => Math.round(n * 100) / 100;

// Resumo compacto dos dados financeiros para o modelo responder perguntas.
export function montarContexto({ transacoes, planejamento, mesAtual, saldoAtual = 0 }) {
  const serie = serieMensal(transacoes, planejamento, mesAtual, 6);
  const proj = projecao(transacoes, planejamento, {
    mesAtual,
    meses: 12,
    saldoInicial: saldoAtual,
    mesesHistorico: config.summary.mesesHistoricoVariavel,
  });
  const desde = addMeses(mesAtual, -3);
  const porLoja = {};
  for (const t of transacoes) {
    if (!['compra', 'pix_enviado', 'debito', 'outro'].includes(t.tipo) || mesDe(t.data) < desde) continue;
    const k = t.estabelecimento.replace(/\s*\(parcela.*\)$/i, '');
    porLoja[k] ??= { total: 0, vezes: 0, categoria: t.categoria };
    porLoja[k].total = round(porLoja[k].total + t.valor);
    porLoja[k].vezes++;
  }
  const vigentes = planejamento.filter((p) => p.recorrente && (!p.fim || mesDe(p.fim) >= mesAtual) && mesDe(p.inicio) <= addMeses(mesAtual, 12));
  const recentes = transacoes
    .filter((t) => mesDe(t.data) >= addMeses(mesAtual, -1))
    .sort((a, b) => (a.data < b.data ? 1 : -1))
    .slice(0, 150)
    .map((t) => [t.data, t.valor, t.estabelecimento, t.conta_ou_cartao, t.categoria, t.tipo].join(' | '));
  return {
    hoje: new Date().toISOString().slice(0, 10),
    mes_atual: mesAtual,
    saldo_atual_informado: saldoAtual,
    ultimos_6_meses: serie,
    receitas_e_fixos_vigentes: vigentes.map((p) => ({
      descricao: p.descricao, responsavel: p.responsavel, direcao: p.direcao, valor: p.valor, categoria: p.categoria, desde: mesDe(p.inicio), ate: p.fim ? mesDe(p.fim) : null,
    })),
    parcelamentos_em_aberto: proj.parcelamentos,
    projecao_12_meses: proj.meses.map(({ pontuais, ...m }) => m),
    media_gastos_variaveis: proj.media_variavel_mensal,
    maiores_estabelecimentos_3_meses: Object.entries(porLoja).sort((a, b) => b[1].total - a[1].total).slice(0, 25),
    transacoes_recentes: recentes,
  };
}

const INSTRUCOES = `Você é o assistente financeiro do gastos-sync, o app de orçamento doméstico do Marcus e da Becca.
Responda em português do Brasil, de forma direta e prática, usando os DADOS abaixo (valores em R$).
- Baseie números só nos dados; se faltar informação, diga o que falta. Não invente transações.
- "saidas" de um mês já somam gastos registrados/planejados e faturas de cartões sem detalhe ("Cartões (fatura)").
- Para "quando comprar X por R$ Z": use a projeção (saldo_projetado, resultado_mes, parcelas terminando) e sugira o mês e, se fizer sentido, parcelamento.
- Para reduzir custos: aponte categorias/estabelecimentos que mais pesam, assinaturas recorrentes e parcelas, com valores.
- Use listas curtas e negrito para números importantes. Formate dinheiro como R$ 1.234,56 e datas como mm/aaaa ou dd/mm/aaaa.`;

export async function responderChat({ mensagens, contexto, ai = getClient() }) {
  const { model, fallbackModel } = config.gemini;
  const modelo = process.env.GEMINI_CHAT_MODEL || model;
  const contents = mensagens.slice(-12).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.texto || '').slice(0, 4000) }],
  }));
  const gerar = (m) =>
    ai.models.generateContent({
      model: m,
      contents,
      config: {
        temperature: 0.3,
        systemInstruction: `${INSTRUCOES}\n\nDADOS (JSON):\n${JSON.stringify(contexto)}`,
        thinkingConfig: { thinkingLevel: process.env.GEMINI_CHAT_THINKING || 'low' },
      },
    });
  let r;
  try {
    r = await gerar(modelo);
  } catch (err) {
    if (!fallbackModel || fallbackModel === modelo || ![500, 503, 404].includes(err?.status ?? err?.code)) throw err;
    r = await gerar(fallbackModel);
  }
  return r.text || 'Não consegui gerar uma resposta agora.';
}
