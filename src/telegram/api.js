import { createHash } from 'node:crypto';

export const segredoWebhook = (token) => createHash('sha256').update(`webhook|${token}`).digest('hex').slice(0, 48);

export function createTelegram(token, fetchImpl = fetch) {
  const chamar = async (metodo, body) => {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/${metodo}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(`Telegram ${metodo}: ${data.description || res.status}`);
    return data.result;
  };
  return {
    chamar,
    enviar: (chatId, texto, extra = {}) =>
      chamar('sendMessage', { chat_id: chatId, text: String(texto).slice(0, 4000), link_preview_options: { is_disabled: true }, ...extra }),
    digitando: (chatId) => chamar('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {}),
    responderCallback: (id, texto) => chamar('answerCallbackQuery', { callback_query_id: id, text: texto }).catch(() => {}),
    editarTeclado: (chatId, messageId) => chamar('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {}),
    async baixar(fileId) {
      const f = await chamar('getFile', { file_id: fileId });
      const res = await fetchImpl(`https://api.telegram.org/file/bot${token}/${f.file_path}`);
      if (!res.ok) throw new Error(`Telegram download: ${res.status}`);
      return Buffer.from(await res.arrayBuffer()).toString('base64');
    },
    configurarWebhook: (url, secret) =>
      chamar('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false }),
    configurarComandos: () =>
      chamar('setMyCommands', {
        commands: [
          { command: 'resumo', description: 'Resumo do mês' },
          { command: 'contas', description: 'Contas do mês e o que falta pagar' },
          { command: 'semana', description: 'Resumo da semana' },
          { command: 'revisar', description: 'Caixa de revisão do mês' },
          { command: 'fechamento', description: 'Fechamento do mês passado' },
          { command: 'ajuda', description: 'Como registrar gastos' },
        ],
      }),
  };
}
