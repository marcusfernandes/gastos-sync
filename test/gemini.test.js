import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmail } from '../src/parser/gemini.js';

process.env.GEMINI_API_KEY ||= 'test-key';

test('parseEmail pede JSON estruturado e normaliza a resposta', async () => {
  let request;
  const ai = {
    models: {
      generateContent: async (req) => {
        request = req;
        return {
          text: JSON.stringify({
            transacoes: [
              { data: '2026-11-05', valor: 1234.56, estabelecimento: 'Padaria São José', conta_ou_cartao: 'Nubank', categoria: 'Alimentação', tipo: 'compra' },
              { data: '2026-11-05', valor: 0, estabelecimento: 'inválida', conta_ou_cartao: 'Nubank', categoria: 'Outros', tipo: 'outro' },
            ],
          }),
        };
      },
    },
  };
  const email = { id: 'm1', from: 'Nubank <todomundo@nubank.com.br>', subject: 'Compra aprovada', date: '2026-11-05T15:00:00Z', body: 'R$ 1.234,56 Padaria' };
  const result = await parseEmail(email, ai);

  assert.equal(request.config.responseMimeType, 'application/json');
  assert.ok(request.config.responseJsonSchema.properties.transacoes);
  assert.match(request.contents, /Compra aprovada/);
  assert.equal(result.length, 1);
  assert.equal(result[0].estabelecimento, 'Padaria São José');
  assert.equal(result[0].origem_email_id, 'm1');
});
