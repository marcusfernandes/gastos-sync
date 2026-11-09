import { GoogleGenAI } from '@google/genai';
import { CATEGORIAS, config } from '../config.js';
import { buildPrompt, schemaTransacoes } from './prompt.js';
import { normalizeTransacao, posProcessar } from './normalize.js';

let client;
function getClient() {
  client ??= new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return client;
}

async function withRetry(fn, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status ?? err?.code;
      const cotaDiaria = /per day/i.test(err?.message || '');
      const retryable = (status === 429 && !cotaDiaria) || (status >= 500 && status < 600);
      if (!retryable || attempt >= tries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

const indisponivel = (err) => [500, 503, 404].includes(err?.status ?? err?.code);

export async function parseEmail(email, ai = getClient(), { categorias = CATEGORIAS, regras } = {}) {
  const { model, fallbackModel, thinking } = config.gemini;
  const thinkingConfig = thinking === 'off' ? undefined : { thinkingLevel: thinking };
  const gerar = (modelo) =>
    ai.models.generateContent({
      model: modelo,
      contents: [
        {
          role: 'user',
          parts: [
            { text: buildPrompt(email, categorias) },
            ...(email.anexos || []).map((a) => ({ inlineData: { mimeType: a.mimeType, data: a.data } })),
          ],
        },
      ],
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseJsonSchema: schemaTransacoes(categorias),
        ...(thinkingConfig && { thinkingConfig }),
      },
    });
  let response;
  try {
    response = await withRetry(() => gerar(model));
  } catch (err) {
    if (!fallbackModel || fallbackModel === model || !indisponivel(err)) throw err;
    response = await withRetry(() => gerar(fallbackModel));
  }
  const parsed = JSON.parse(response.text || '{"transacoes":[]}');
  const transacoes = (parsed.transacoes || []).map((t) => normalizeTransacao(t, email, categorias)).filter(Boolean);
  return posProcessar(transacoes, regras);
}

// Classifica nomes de estabelecimentos (ex.: vindos do Open Finance) numa única chamada barata.
export async function categorizarEstabelecimentos(nomes, categorias = CATEGORIAS, ai = getClient()) {
  if (!nomes.length) return new Map();
  const { model, thinking } = config.gemini;
  const thinkingConfig = thinking === 'off' ? undefined : { thinkingLevel: thinking };
  const response = await withRetry(() =>
    ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Classifique cada estabelecimento de compras/pagamentos de uma família brasileira em uma das categorias: ${categorias.join(', ')}. Use "Outros" quando não tiver certeza.\n\n${nomes.map((n, i) => `${i + 1}. ${n}`).join('\n')}`,
            },
          ],
        },
      ],
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: 'object',
          properties: {
            itens: {
              type: 'array',
              items: {
                type: 'object',
                properties: { numero: { type: 'integer' }, categoria: { type: 'string', enum: categorias } },
                required: ['numero', 'categoria'],
              },
            },
          },
          required: ['itens'],
        },
        ...(thinkingConfig && { thinkingConfig }),
      },
    }),
  );
  const { itens = [] } = JSON.parse(response.text || '{}');
  return new Map(itens.filter((i) => nomes[i.numero - 1] && categorias.includes(i.categoria)).map((i) => [nomes[i.numero - 1], i.categoria]));
}
