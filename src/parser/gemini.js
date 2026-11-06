import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { buildPrompt, transacoesSchema } from './prompt.js';
import { normalizeTransacao } from './normalize.js';

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

export async function parseEmail(email, ai = getClient()) {
  const { model, fallbackModel, thinking } = config.gemini;
  const thinkingConfig = thinking === 'off' ? undefined : { thinkingLevel: thinking };
  const gerar = (modelo) =>
    ai.models.generateContent({
      model: modelo,
      contents: [
        {
          role: 'user',
          parts: [
            { text: buildPrompt(email) },
            ...(email.anexos || []).map((a) => ({ inlineData: { mimeType: a.mimeType, data: a.data } })),
          ],
        },
      ],
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseJsonSchema: transacoesSchema,
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
  return (parsed.transacoes || []).map((t) => normalizeTransacao(t, email)).filter(Boolean);
}
