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
      const retryable = status === 429 || (status >= 500 && status < 600);
      if (!retryable || attempt >= tries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

export async function parseEmail(email, ai = getClient()) {
  const response = await withRetry(() =>
    ai.models.generateContent({
      model: config.gemini.model,
      contents: buildPrompt(email),
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseJsonSchema: transacoesSchema,
      },
    }),
  );
  const parsed = JSON.parse(response.text || '{"transacoes":[]}');
  return (parsed.transacoes || []).map((t) => normalizeTransacao(t, email)).filter(Boolean);
}
