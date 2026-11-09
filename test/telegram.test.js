import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.PAINEL_SENHA = 'segredo';
const { interpretarLancamento, processarUpdate, enviarAlertas } = await import('../src/telegram/bot.js');
const { createMemoryStorage } = await import('../src/storage/memory.js');

function fakeTg() {
  const enviadas = [];
  return {
    enviadas,
    enviar: async (chatId, texto, extra) => enviadas.push({ chatId, texto, extra }),
    digitando: async () => {},
    responderCallback: async () => {},
    editarTeclado: async () => {},
    baixar: async () => 'AAAA',
  };
}
const msg = (text, id = 1, chat = 42) => ({ message: { message_id: id, chat: { id: chat }, from: { first_name: 'Marcus' }, text } });

test('interpreta lançamentos rápidos', () => {
  assert.deepEqual(interpretarLancamento('mercado 120 pix', '2026-11-09'), { data: '2026-11-09', valor: 120, estabelecimento: 'Mercado', conta_ou_cartao: 'Manual', tipo: 'pix_enviado' });
  assert.equal(interpretarLancamento('uber 23,90 nubank', '2026-11-09').tipo, 'compra');
  assert.equal(interpretarLancamento('farmácia 45 débito ontem', '2026-11-09').data, '2026-11-08');
  assert.equal(interpretarLancamento('R$ 1.200 aluguel', '2026-11-09').valor, 1200);
  assert.equal(interpretarLancamento('recebi 300 pix venda', '2026-11-09').tipo, 'pix_recebido');
  assert.equal(interpretarLancamento('quanto gastei em mercado?'), null);
  assert.equal(interpretarLancamento('120'), null);
});

test('só aceita chats conectados com a senha do painel', async () => {
  const storage = await createMemoryStorage();
  const tg = fakeTg();
  await processarUpdate(msg('mercado 120 pix'), { storage, tg });
  assert.match(tg.enviadas.at(-1).texto, /não está conectado/);
  await processarUpdate(msg('/start errada'), { storage, tg });
  assert.match(tg.enviadas.at(-1).texto, /senha do painel/);
  await processarUpdate(msg('/start segredo'), { storage, tg });
  assert.match(tg.enviadas.at(-1).texto, /Conectado, Marcus/);
  assert.equal((await storage.listTransacoes()).length, 0);
});

test('registra, não duplica em reenvio e desfaz', async () => {
  const storage = await createMemoryStorage();
  const tg = fakeTg();
  const categorizar = async (nomes) => Object.fromEntries(nomes.map((n) => [n, 'Mercado']));
  await processarUpdate(msg('/start segredo'), { storage, tg });
  await processarUpdate(msg('mercado 120 pix', 7), { storage, tg, categorizar });
  await processarUpdate(msg('mercado 120 pix', 7), { storage, tg, categorizar });
  await processarUpdate(msg('mercado 120 pix', 8), { storage, tg, categorizar });
  const tx = await storage.listTransacoes();
  assert.equal(tx.length, 2);
  assert.equal(tx[0].categoria, 'Mercado');
  assert.equal(tx[0].origem_email_id, 'telegram:42:7');
  assert.match(tg.enviadas[1].texto, /Registrado:\n• Mercado: R\$\s?120,00 · Pix · Mercado/);
  assert.equal(tg.enviadas[1].extra.reply_markup.inline_keyboard[0][0].callback_data, 'del:7');
  await processarUpdate({ callback_query: { id: 'q', data: 'del:7', message: { message_id: 99, chat: { id: 42 } } } }, { storage, tg });
  assert.equal((await storage.listTransacoes()).length, 1);
});

test('foto vira transação pelo parser e pergunta vai para a IA', async () => {
  const storage = await createMemoryStorage();
  const tg = fakeTg();
  await processarUpdate(msg('/start segredo'), { storage, tg });
  const parse = async (email) => {
    assert.equal(email.anexos[0].mimeType, 'image/jpeg');
    return [{ data: '2026-11-09', valor: 89.9, estabelecimento: 'Drogasil', conta_ou_cartao: 'Nubank', categoria: 'Saúde', tipo: 'debito', vencimento: null }];
  };
  await processarUpdate({ message: { message_id: 3, chat: { id: 42 }, photo: [{ file_id: 'a' }, { file_id: 'b' }] } }, { storage, tg, parse });
  assert.equal((await storage.listTransacoes())[0].estabelecimento, 'Drogasil');
  await processarUpdate(msg('onde mais gastamos?', 4), { storage, tg, responderChat: async () => 'Em **Saúde**.' });
  assert.equal(tg.enviadas.at(-1).texto, 'Em Saúde.');
});

test('avisa contas atrasadas uma vez por dia', async () => {
  const storage = await createMemoryStorage();
  const tg = fakeTg();
  await processarUpdate(msg('/start segredo'), { storage, tg });
  await storage.addPlanejamento({ descricao: 'Condomínio', direcao: 'saida', valor: 800, categoria: 'Moradia', recorrente: true, inicio: '2026-01-01', fim: null });
  await storage.setConfig('contas_dias', JSON.stringify({ 'fixo:condominio': 5 }));
  const agora = new Date('2026-11-10T12:00:00Z');
  tg.enviadas.length = 0;
  await enviarAlertas({ storage, tg, agora, hora: 8 });
  assert.match(tg.enviadas[0].texto, /Condomínio: R\$\s?800,00 — venceu 05\/11\/2026/);
  await enviarAlertas({ storage, tg, agora: new Date('2026-11-10T15:00:00Z'), hora: 8 });
  assert.equal(tg.enviadas.length, 1);
});

test('resumo semanal às segundas', async () => {
  const storage = await createMemoryStorage();
  const tg = fakeTg();
  await processarUpdate(msg('/start segredo'), { storage, tg });
  await storage.saveTransacoes([{ data: '2026-11-08', valor: 50, estabelecimento: 'Padaria', conta_ou_cartao: 'Manual', categoria: 'Alimentação', tipo: 'pix_enviado', dedupe_key: 'x' }]);
  tg.enviadas.length = 0;
  await enviarAlertas({ storage, tg, agora: new Date('2026-11-09T12:00:00Z'), hora: 8 });
  assert.match(tg.enviadas.at(-1).texto, /Resumo da semana[\s\S]*Padaria: R\$\s?50,00/);
});

test('avisa meta de categoria passando de 80% uma vez só no mês', async () => {
  const storage = await createMemoryStorage();
  const tg = fakeTg();
  await processarUpdate(msg('/start segredo'), { storage, tg });
  await storage.setConfig('orcamentos', JSON.stringify({ Lazer: 100 }));
  await storage.saveTransacoes([{ data: '2026-11-08', valor: 85, estabelecimento: 'Cinema', conta_ou_cartao: 'Manual', categoria: 'Lazer', tipo: 'pix_enviado', dedupe_key: 'c1' }]);
  tg.enviadas.length = 0;
  await enviarAlertas({ storage, tg, agora: new Date('2026-11-10T12:00:00Z'), hora: 8 });
  assert.match(tg.enviadas.at(-1).texto, /Lazer: R\$\s?85,00 de R\$\s?100,00 \(85%\)/);
  const n = tg.enviadas.length;
  await enviarAlertas({ storage, tg, agora: new Date('2026-11-10T15:00:00Z'), hora: 8 });
  assert.equal(tg.enviadas.length, n);
  await storage.saveTransacoes([{ data: '2026-11-09', valor: 30, estabelecimento: 'Bar', conta_ou_cartao: 'Manual', categoria: 'Lazer', tipo: 'pix_enviado', dedupe_key: 'c2' }]);
  await enviarAlertas({ storage, tg, agora: new Date('2026-11-10T18:00:00Z'), hora: 8 });
  assert.match(tg.enviadas.at(-1).texto, /meta estourada/);
});
