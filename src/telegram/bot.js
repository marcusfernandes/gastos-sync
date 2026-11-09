import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { categorizarEstabelecimentos, parseEmail } from '../parser/gemini.js';
import { chaveEstabelecimento, normalizarTexto } from '../parser/normalize.js';
import { contextoParser } from '../storage/index.js';
import { montarContexto, responderChat } from '../chat.js';
import { addMeses } from '../summary/forecast.js';
import { gerarRelatorio } from '../summary/service.js';
import { carregarContas, hojeBR, lerJsonConfig } from '../summary/contas.js';
import { assinaturas, caixaRevisao, conferencia, orcamentoDoMes } from '../summary/analises.js';
import { lerRevisados, marcarRevisados } from '../summary/revisao.js';
import { lerMetas } from '../summary/metas.js';
import { gerarFechamento, textoFechamento } from '../summary/fechamento.js';

const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (d) => (d ? d.split('-').reverse().join('/') : '');
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesBR = (m) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
const round = (n) => Math.round(n * 100) / 100;
const addDias = (data, n) => new Date(Date.parse(`${data}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const NOMES_TIPO = { pix_enviado: 'Pix', pix_recebido: 'Pix recebido', debito: 'Débito', compra: 'Cartão de crédito', outro: 'Outro' };

const CONTAS = [
  [/^(nubank|nu)$/, 'Nubank'],
  [/^(itau|pda)$/, 'Itaú'],
  [/^(bradesco|nanquim)$/, 'Bradesco'],
  [/^infinit[ey]?$/, 'Infinit'],
  [/^santander$/, 'Santander'],
  [/^caixa$/, 'Caixa'],
  [/^inter$/, 'Inter'],
  [/^c6$/, 'C6'],
  [/^leroy$/, 'Leroy Merlin'],
  [/^(mp|mercadopago)$/, 'Mercado Pago'],
];

const VALOR_RE = /^(?:r\$)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)$/i;

const paraNumero = (s) => {
  const t = s.replace(/^r\$/i, '');
  if (/,\d{1,2}$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  return Number(t);
};

// "mercado 120 pix", "uber 23,90 nubank", "recebi 300 pix joão", "farmácia 45 débito ontem".
// Retorna null quando não parece um lançamento (aí a mensagem vai para o chat com a IA).
export function interpretarLancamento(texto, hoje = hojeBR()) {
  const original = String(texto || '').trim();
  if (!original || original.startsWith('/') || original.endsWith('?')) return null;
  const palavras = original.replace(/mercado\s+pago/i, 'mercadopago').split(/\s+/);
  if (palavras.length > 10) return null;

  let valor = null;
  let tipo = null;
  let conta = null;
  let data = hoje;
  let recebido = false;
  const resto = [];
  for (const p of palavras) {
    const n = normalizarTexto(p).replace(/\s+/g, '');
    if (valor == null && VALOR_RE.test(p.replace(/^r\$/i, ''))) valor = paraNumero(p);
    else if (n === 'r' && /^r\$$/i.test(p)) continue;
    else if (n === 'pix') tipo ??= 'pix';
    else if (['debito', 'deb'].includes(n)) tipo = 'debito';
    else if (['credito', 'cartao', 'cred'].includes(n)) tipo = 'compra';
    else if (['dinheiro', 'especie'].includes(n)) tipo = 'outro';
    else if (['recebi', 'recebido', 'entrada'].includes(n) && !resto.length) recebido = true;
    else if (n === 'ontem') data = addDias(hoje, -1);
    else if (n === 'anteontem') data = addDias(hoje, -2);
    else if (/^\d{1,2}\/\d{1,2}$/.test(p)) {
      const [d, m] = p.split('/').map(Number);
      const ano = Number(hoje.slice(0, 4)) - (m > Number(hoje.slice(5, 7)) ? 1 : 0);
      data = `${ano}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    } else if (!conta && CONTAS.some(([re]) => re.test(n))) conta = CONTAS.find(([re]) => re.test(n))[1];
    else resto.push(p);
  }
  if (!(valor > 0)) return null;
  if (!resto.length && !recebido) return null;

  const tipoFinal = recebido ? 'pix_recebido' : tipo === 'pix' ? 'pix_enviado' : tipo ?? (conta ? 'compra' : 'pix_enviado');
  const descricao = resto.join(' ').replace(/^(no|na|de|do|da|em)\s+/i, '');
  return {
    data,
    valor: round(valor),
    estabelecimento: descricao ? descricao[0].toUpperCase() + descricao.slice(1) : 'Recebimento',
    conta_ou_cartao: conta || 'Manual',
    tipo: tipoFinal,
  };
}

const segredoOk = (dado, esperado) => {
  const a = Buffer.from(String(dado || ''));
  const b = Buffer.from(String(esperado || ''));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
};

const chaveTelegram = (chatId, msgId, i = 0) => createHash('sha256').update(`telegram|${chatId}|${msgId}|${i}`).digest('hex');

export async function chatsAutorizados(storage) {
  const v = await lerJsonConfig(storage, 'telegram_chats');
  return Array.isArray(v.chats) ? v.chats : [];
}

async function saldoAtual(storage) {
  const s = JSON.parse((await storage.getConfig?.('saldo_atual')) || 'null');
  return s?.valor ?? 0;
}

const AJUDA = `Para registrar um gasto, mande uma mensagem curta:
• mercado 120 pix
• uber 23,90 nubank
• farmácia 45 débito ontem
• almoço 38,50 crédito 12/11
• recebi 300 pix venda bicicleta

Também dá para mandar a foto de um comprovante ou nota fiscal.
Qualquer outra pergunta vai para a IA, ex.: "onde mais gastamos este mês?"

Comandos: /resumo, /contas, /semana, /revisar, /fechamento, /ajuda`;

export async function textoResumo(storage, mes = hojeBR().slice(0, 7)) {
  const { resumo: r, projecao: p } = await gerarRelatorio({ mes, meses: 3, saldoInicial: await saldoAtual(storage), storage });
  const cats = Object.entries(r.gastos.por_categoria || {}).slice(0, 4);
  const linhas = [
    `Resumo de ${mesBR(mes)}`,
    `Entradas: ${brl(r.entradas.cadastradas + (r.entradas.recebidas_pix || 0))}`,
    `Gastos registrados: ${brl(r.gastos.registrados)}`,
    `Fixos planejados: ${brl(r.gastos.fixos_planejados + (r.gastos.pontuais_planejados || 0))}`,
  ];
  if (r.gastos.faturas_sem_detalhe) linhas.push(`Faturas sem detalhe: ${brl(r.gastos.faturas_sem_detalhe)}`);
  linhas.push(`Saldo estimado do mês: ${brl(r.saldo_estimado)}`);
  if (cats.length) linhas.push('', 'Maiores categorias:', ...cats.map(([c, v]) => `• ${c}: ${brl(v)}`));
  const meses = p.meses || [];
  if (meses.length) linhas.push('', 'Saldo projetado:', ...meses.map((m) => `• ${mesBR(m.mes)}: ${brl(m.saldo_projetado)}`));
  return linhas.join('\n');
}

const SELO = { atrasada: '🔴', vence_logo: '🟡', aberta: '⚪', sem_data: '⚪', pago: '✅' };

export async function textoContas(storage, mes = hojeBR().slice(0, 7)) {
  const c = await carregarContas(storage, mes);
  if (!c.contas.length) return `Nenhuma conta em ${mesBR(mes)}.`;
  return [
    `Contas de ${mesBR(mes)}: pago ${brl(c.pago)} de ${brl(c.total)}, falta ${brl(c.em_aberto)}.`,
    '',
    ...c.contas.map((x) => `${SELO[x.status]} ${x.descricao}: ${brl(x.valor)}${x.vencimento ? ` (vence ${dataBR(x.vencimento)})` : ''}`),
    '',
    'Marque o que já foi pago no painel, em Visão geral → Contas do mês.',
  ].join('\n');
}

export async function textoSemana(storage, hoje = hojeBR()) {
  const inicio = addDias(hoje, -7);
  const anterior = addDias(hoje, -14);
  const tx = await storage.listTransacoes({ desde: anterior });
  const gasto = (t) => ['compra', 'pix_enviado', 'debito', 'outro'].includes(t.tipo);
  const semana = tx.filter((t) => gasto(t) && t.data > inicio && t.data <= hoje);
  const antes = tx.filter((t) => gasto(t) && t.data > anterior && t.data <= inicio);
  const total = round(semana.reduce((s, t) => s + t.valor, 0));
  const totalAntes = round(antes.reduce((s, t) => s + t.valor, 0));
  const soma = (k) => Object.entries(semana.reduce((o, t) => ({ ...o, [k(t)]: round((o[k(t)] || 0) + t.valor) }), {})).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const linhas = [`Resumo da semana (${dataBR(addDias(inicio, 1))} a ${dataBR(hoje)})`, `Gastos lançados: ${brl(total)} em ${semana.length} lançamento${semana.length === 1 ? '' : 's'}`];
  if (totalAntes) {
    const v = (total - totalAntes) / totalAntes;
    linhas.push(`Semana anterior: ${brl(totalAntes)} (${v >= 0 ? '+' : ''}${Math.round(v * 100)}%)`);
  }
  if (semana.length) {
    linhas.push('', 'Por categoria:', ...soma((t) => t.categoria).map(([c, v]) => `• ${c}: ${brl(v)}`));
    linhas.push('', 'Onde mais gastou:', ...soma((t) => t.estabelecimento.replace(/\s*\(parcela.*\)$/i, '')).map(([c, v]) => `• ${c}: ${brl(v)}`));
  }
  const contas = await carregarContas(storage, hoje.slice(0, 7), hoje);
  const proximas = contas.contas.filter((c) => !c.pago_em && c.vencimento && c.vencimento <= addDias(hoje, 7));
  if (proximas.length) linhas.push('', 'Contas até a próxima semana:', ...proximas.map((c) => `${SELO[c.status]} ${c.descricao}: ${brl(c.valor)} (vence ${dataBR(c.vencimento)})`));
  linhas.push('', 'Compras de cartão aparecem conforme as faturas e notificações chegam.');
  return linhas.join('\n');
}

async function categorizar(storage, t, deps) {
  const { categorias, regras } = await contextoParser(storage);
  if (t.tipo === 'pix_recebido') return { ...t, categoria: categorias.includes('Transferências') ? 'Transferências' : 'Outros' };
  const regra = regras.get(chaveEstabelecimento(t.estabelecimento));
  if (regra) return { ...t, categoria: regra };
  const r = await (deps.categorizar || categorizarEstabelecimentos)([t.estabelecimento], categorias).catch(() => ({}));
  return { ...t, categoria: r[t.estabelecimento] || 'Outros' };
}

async function salvar(storage, tg, chatId, msgId, transacoes) {
  const rows = transacoes.map((t, i) => ({
    ...t,
    vencimento: t.vencimento ?? null,
    origem_email_id: `telegram:${chatId}:${msgId}`,
    origem_assunto: 'Telegram',
    dedupe_key: chaveTelegram(chatId, msgId, i),
  }));
  const { inserted } = await storage.saveTransacoes(rows);
  if (!inserted.length) return tg.enviar(chatId, 'Esse lançamento já estava registrado.');
  const linhas = inserted.map((t) => `• ${t.estabelecimento}: ${brl(t.valor)} · ${NOMES_TIPO[t.tipo] || t.tipo}${t.conta_ou_cartao !== 'Manual' ? ` ${t.conta_ou_cartao}` : ''} · ${t.categoria} · ${dataBR(t.data)}`);
  const avisoCartao = inserted.some((t) => t.tipo === 'compra')
    ? '\n\nCompra no crédito: se esse cartão já chega por fatura ou Open Finance, ela vai aparecer de novo. Nesse caso, desfaça aqui.'
    : '';
  return tg.enviar(chatId, `Registrado:\n${linhas.join('\n')}${avisoCartao}`, {
    reply_markup: { inline_keyboard: [[{ text: 'Desfazer', callback_data: `del:${msgId}` }]] },
  });
}

const historicos = new Map();

async function conversar(storage, tg, chatId, texto, deps) {
  const mesAtual = hojeBR().slice(0, 7);
  const [transacoes, planejamento, saldo, metas] = await Promise.all([
    storage.listTransacoes({ desde: `${addMeses(mesAtual, -7)}-01` }),
    storage.listPlanejamento(),
    saldoAtual(storage),
    lerMetas(storage),
  ]);
  const contexto = montarContexto({ transacoes, planejamento, mesAtual, saldoAtual: saldo, metas });
  const hist = historicos.get(chatId) || [];
  hist.push({ role: 'user', texto });
  const resposta = await (deps.responderChat || responderChat)({ mensagens: hist, contexto });
  hist.push({ role: 'assistant', texto: resposta });
  historicos.set(chatId, hist.slice(-8));
  return tg.enviar(chatId, resposta.replace(/\*\*(.+?)\*\*/g, '$1'));
}

async function lerAnexo(storage, tg, msg, deps) {
  const foto = msg.photo?.at(-1);
  const doc = msg.document;
  const mimeType = foto ? 'image/jpeg' : doc?.mime_type;
  if (!mimeType || !/^(image\/|application\/pdf)/.test(mimeType)) return null;
  const data = await tg.baixar(foto ? foto.file_id : doc.file_id);
  const ctx = await contextoParser(storage);
  const email = {
    id: `telegram:${msg.chat.id}:${msg.message_id}`,
    from: 'Telegram (enviado pelo usuário)',
    subject: 'Comprovante, nota fiscal ou fatura enviado pelo Telegram',
    date: new Date().toISOString(),
    body: msg.caption || 'Imagem/PDF de comprovante, nota fiscal ou fatura. Extraia o gasto (uma transação com o valor total, a menos que seja fatura de cartão).',
    anexos: [{ mimeType, data, filename: doc?.file_name || 'foto.jpg' }],
  };
  return (deps.parse || parseEmail)(email, undefined, ctx);
}

export async function processarUpdate(update, { storage, tg, ...deps }) {
  if (update.callback_query) {
    const q = update.callback_query;
    const chatId = q.message?.chat?.id;
    if (!(await chatsAutorizados(storage)).some((c) => c.id === chatId)) return tg.responderCallback(q.id, 'Chat não autorizado');
    const [acao, msgId] = String(q.data || '').split(':');
    if (acao === 'rok' || acao === 'rdel') {
      if (acao === 'rdel') await storage.deleteTransacao(msgId);
      else await marcarRevisados(storage, [msgId]);
      await tg.editarTeclado(chatId, q.message.message_id);
      return tg.responderCallback(q.id, acao === 'rdel' ? 'Apagado' : 'Conferido');
    }
    if (acao !== 'del') return tg.responderCallback(q.id);
    const origem = `telegram:${chatId}:${msgId}`;
    const recentes = await storage.listTransacoes({ desde: addDias(hojeBR(), -120) });
    const alvo = recentes.filter((t) => t.origem_email_id === origem);
    for (const t of alvo) await storage.deleteTransacao(t.id);
    await tg.editarTeclado(chatId, q.message.message_id);
    await tg.responderCallback(q.id, alvo.length ? 'Desfeito' : 'Nada para desfazer');
    return alvo.length ? tg.enviar(chatId, `Desfeito: ${alvo.map((t) => `${t.estabelecimento} ${brl(t.valor)}`).join(', ')}`) : null;
  }

  const msg = update.message;
  if (!msg?.chat) return null;
  const chatId = msg.chat.id;
  const texto = String(msg.text || '').trim();
  const chats = await chatsAutorizados(storage);
  const autorizado = chats.some((c) => c.id === chatId);

  if (/^\/start\b/.test(texto)) {
    const senha = texto.replace(/^\/start(@\w+)?\s*/, '');
    if (autorizado) return tg.enviar(chatId, `Este chat já está conectado.\n\n${AJUDA}`);
    if (!segredoOk(senha, config.painel.senha)) return tg.enviar(chatId, 'Para conectar, mande /start seguido da senha do painel. Ex.: /start minhasenha');
    const nome = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.chat.title || String(chatId);
    await storage.setConfig('telegram_chats', JSON.stringify({ chats: [...chats, { id: chatId, nome, desde: new Date().toISOString() }] }));
    return tg.enviar(chatId, `Conectado, ${nome}! Você vai receber aqui os avisos de contas e o resumo semanal.\n\n${AJUDA}`);
  }
  if (!autorizado) return tg.enviar(chatId, 'Este chat ainda não está conectado ao gastos-sync. Mande /start seguido da senha do painel.');

  await tg.digitando(chatId);
  const comando = texto.match(/^\/(\w+)/)?.[1];
  if (comando === 'ajuda' || comando === 'help') return tg.enviar(chatId, AJUDA);
  if (comando === 'resumo') return tg.enviar(chatId, await textoResumo(storage));
  if (comando === 'contas') return tg.enviar(chatId, await textoContas(storage));
  if (comando === 'semana') return tg.enviar(chatId, await textoSemana(storage));
  if (comando === 'revisar') return enviarRevisao(storage, tg, chatId);
  if (comando === 'fechamento') return tg.enviar(chatId, await textoDoFechamento(storage, addMeses(hojeBR().slice(0, 7), -1)));
  if (comando === 'sair') {
    await storage.setConfig('telegram_chats', JSON.stringify({ chats: chats.filter((c) => c.id !== chatId) }));
    return tg.enviar(chatId, 'Chat desconectado. Para voltar, mande /start e a senha.');
  }
  if (comando) return tg.enviar(chatId, `Comando desconhecido.\n\n${AJUDA}`);

  if (msg.photo || msg.document) {
    const lidas = await lerAnexo(storage, tg, msg, deps);
    if (lidas == null) return tg.enviar(chatId, 'Só consigo ler fotos e PDFs.');
    if (!lidas.length) return tg.enviar(chatId, 'Não encontrei nenhum gasto nesse arquivo. Tente uma foto mais nítida ou mande em texto, ex.: "mercado 120 pix".');
    return salvar(storage, tg, chatId, msg.message_id, lidas);
  }

  const lancamento = interpretarLancamento(texto);
  if (lancamento) return salvar(storage, tg, chatId, msg.message_id, [await categorizar(storage, lancamento, deps)]);
  if (!texto) return null;
  return conversar(storage, tg, chatId, texto, deps);
}

export const textoDoFechamento = async (storage, mes) => textoFechamento(await gerarFechamento(storage, mes), { brl, mesBR });

async function enviarRevisao(storage, tg, chatId) {
  const mes = hojeBR().slice(0, 7);
  const [transacoes, revisados] = await Promise.all([storage.listTransacoes({ desde: `${addMeses(mes, -7)}-01` }), lerRevisados(storage)]);
  const itens = caixaRevisao(transacoes, mes, revisados);
  if (!itens.length) return tg.enviar(chatId, 'Caixa de revisão vazia. Nada para conferir neste mês.');
  await tg.enviar(chatId, `${itens.length} ${itens.length > 1 ? 'itens' : 'item'} para conferir${itens.length > 5 ? ' (mostrando 5)' : ''}:`);
  for (const { transacao: t, motivo } of itens.slice(0, 5)) {
    await tg.enviar(chatId, `${t.estabelecimento} — ${brl(t.valor)}\n${dataBR(t.data)} · ${t.conta_ou_cartao} · ${t.categoria}\n${motivo}`, {
      reply_markup: { inline_keyboard: [[{ text: '✓ Está certo', callback_data: `rok:${t.id}` }, { text: '🗑 Apagar', callback_data: `rdel:${t.id}` }]] },
    });
  }
  return null;
}

// Metas passando de 80%/100%, assinaturas mais caras e compras repetidas: cada aviso sai uma vez por mês.
export async function avisosDoMes(storage, mes, estado) {
  const [transacoes, limites] = await Promise.all([
    storage.listTransacoes({ desde: `${addMeses(mes, -7)}-01` }),
    lerJsonConfig(storage, 'orcamentos'),
  ]);
  if (estado.avisos?.mes !== mes) estado.avisos = { mes, chaves: [] };
  const ja = new Set(estado.avisos.chaves);
  const linhas = [];
  const novo = (chave, texto) => {
    if (ja.has(chave)) return;
    ja.add(chave);
    linhas.push(texto);
  };
  for (const i of orcamentoDoMes(transacoes, mes, limites).itens) {
    if (i.nivel === 'estourou') novo(`orc:${i.categoria}:100`, `🔴 ${i.categoria}: ${brl(i.gasto)} de ${brl(i.limite)} — meta estourada em ${brl(-i.restante)}`);
    else if (i.nivel === 'alerta') novo(`orc:${i.categoria}:80`, `🟡 ${i.categoria}: ${brl(i.gasto)} de ${brl(i.limite)} (${Math.round(i.percentual * 100)}%) — restam ${brl(i.restante)}`);
  }
  for (const a of assinaturas(transacoes, mes).itens) {
    if (a.aumento && a.ultima_data.startsWith(mes)) novo(`assin:${a.chave}:${a.valor}`, `📈 ${a.estabelecimento} subiu de ${brl(a.valor_anterior)} para ${brl(a.valor)}`);
    if (a.nova) novo(`nova:${a.chave}`, `🆕 Assinatura nova: ${a.estabelecimento} ${brl(a.valor)} (${a.conta_ou_cartao})`);
  }
  for (const [x, y] of conferencia(transacoes, mes).duplicadas) {
    novo(`dup:${x.id}:${y.id}`, `⚠️ Possível compra repetida: ${x.estabelecimento} ${brl(x.valor)} em ${dataBR(x.data)} e ${dataBR(y.data)} (${x.conta_ou_cartao})`);
  }
  estado.avisos.chaves = [...ja];
  return linhas.length ? ['Avisos do mês:', ...linhas, '', 'Detalhes no painel, em Análises.'].join('\n') : null;
}

async function novosParaRevisar(storage, mes, estado) {
  const [transacoes, revisados] = await Promise.all([storage.listTransacoes({ desde: `${addMeses(mes, -7)}-01` }), lerRevisados(storage)]);
  const avisados = new Set(estado.revisao_avisados || []);
  const novos = caixaRevisao(transacoes, mes, revisados).filter((i) => !avisados.has(String(i.transacao.id)) && i.tipo !== 'repetida');
  if (!novos.length) return null;
  estado.revisao_avisados = [...avisados, ...novos.map((i) => String(i.transacao.id))].slice(-1000);
  return [
    `🔎 ${novos.length} ${novos.length > 1 ? 'lançamentos novos' : 'lançamento novo'} para conferir:`,
    ...novos.slice(0, 5).map(({ transacao: t, motivo }) => `• ${t.estabelecimento} ${brl(t.valor)} — ${motivo}`),
    ...(novos.length > 5 ? [`… e mais ${novos.length - 5}`] : []),
    '',
    'Mande /revisar para confirmar ou apagar aqui mesmo.',
  ].join('\n');
}

const horaBR = (agora) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }).format(agora));
const diaSemanaBR = (agora) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(agora);

// Chamado a cada ingestão (3 em 3 horas). Manda no máximo um aviso de contas por dia e o resumo semanal às segundas.
export async function enviarAlertas({ storage, tg, agora = new Date(), hora = config.telegram.horaAlertas, log = console.log }) {
  const chats = await chatsAutorizados(storage);
  if (!chats.length || horaBR(agora) < hora) return { enviados: 0 };
  const hoje = agora.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const estado = await lerJsonConfig(storage, 'telegram_alertas');
  const mensagens = [];

  if (estado.diario !== hoje) {
    estado.diario = hoje;
    const mes = hoje.slice(0, 7);
    const contas = [...(await carregarContas(storage, mes, hoje)).contas];
    if (Number(hoje.slice(8)) >= 25) contas.push(...(await carregarContas(storage, addMeses(mes, 1), hoje)).contas);
    const pendentes = contas.filter((c) => !c.pago_em && ['atrasada', 'vence_logo'].includes(c.status));
    if (pendentes.length) {
      mensagens.push([
        'Contas que precisam de atenção:',
        ...pendentes.map((c) => `${SELO[c.status]} ${c.descricao}: ${brl(c.valor)} — ${c.status === 'atrasada' ? 'venceu' : 'vence'} ${dataBR(c.vencimento)}`),
        '',
        'Já pagou? Marque no painel, em Visão geral → Contas do mês.',
      ].join('\n'));
    }
  }
  if (Number(hoje.slice(8)) <= 3) {
    const fechado = addMeses(hoje.slice(0, 7), -1);
    if (estado.fechamento !== fechado) {
      estado.fechamento = fechado;
      mensagens.push(await textoDoFechamento(storage, fechado));
    }
  }
  const revisar = await novosParaRevisar(storage, hoje.slice(0, 7), estado);
  if (revisar) mensagens.push(revisar);
  const avisos = await avisosDoMes(storage, hoje.slice(0, 7), estado);
  if (avisos) mensagens.push(avisos);

  if (diaSemanaBR(agora) === 'Mon' && estado.semanal !== hoje) {
    estado.semanal = hoje;
    mensagens.push(await textoSemana(storage, hoje));
  }

  await storage.setConfig('telegram_alertas', JSON.stringify(estado));
  let enviados = 0;
  for (const chat of chats) {
    for (const m of mensagens) {
      await tg.enviar(chat.id, m).then(() => enviados++).catch((e) => log(`! Telegram ${chat.nome}: ${e.message}`));
    }
  }
  return { enviados };
}
