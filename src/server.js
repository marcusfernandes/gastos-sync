import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CATEGORIAS, config, googleRedirectUri, publicUrl } from './config.js';
import { createOAuthClient, GMAIL_SCOPES, htmlToText, resolveRefreshToken } from './gmail/client.js';
import { ingestNow } from './ingest.js';
import { parseEmail } from './parser/gemini.js';
import { chaveEstabelecimento, parseData } from './parser/normalize.js';
import { contextoParser, createStorage } from './storage/index.js';
import { addMeses } from './summary/forecast.js';
import { carregarContas, lerJsonConfig } from './summary/contas.js';
import { gerarRelatorio, mesCorrente } from './summary/service.js';
import { serieMensal } from './summary/historico.js';
import { montarContexto, responderChat } from './chat.js';
import { gerarPlano } from './plano.js';
import { assinaturas, caixaRevisao, conferencia, orcamentoDoMes } from './summary/analises.js';
import { lerRevisados, marcarRevisados } from './summary/revisao.js';
import { lerMetas, resumoMetas, validarMetas } from './summary/metas.js';
import { gerarFechamento } from './summary/fechamento.js';
import { CASAL, gastosPorPessoa, pessoasDe } from './summary/pessoas.js';
import { syncPluggy } from './pluggy/sync.js';
import { gerarBackup, nomeBackup, zipar } from './backup.js';
import { createAuth, createLimitador, normalizar } from './auth.js';
import { createTelegram, segredoWebhook } from './telegram/api.js';
import { chatsAutorizados, enviarAlertas, processarUpdate } from './telegram/bot.js';

const telegram = config.telegram.ativo ? createTelegram(config.telegram.token) : null;

const MES_RE = /^\d{4}-\d{2}$/;
const DIST = new URL('../web/dist/', import.meta.url);
const painelHtml = await readFile(new URL('index.html', DIST), 'utf8')
  .catch(() => readFile(new URL('../public/index.html', import.meta.url), 'utf8'));
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

async function sendAsset(res, pathname) {
  const nome = pathname.replace(/^\/+/, '');
  if (!/^[\w./-]+$/.test(nome) || nome.includes('..')) return false;
  const corpo = await readFile(new URL(nome, DIST)).catch(() => null);
  if (!corpo) return false;
  const ext = nome.slice(nome.lastIndexOf('.'));
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': nome.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(corpo);
  return true;
}
const privacidadeHtml = await readFile(new URL('../public/privacidade.html', import.meta.url), 'utf8');
const oauthStates = new Map();
let ingestaoEmAndamento = false;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let storagePromise;
function getStorage() {
  storagePromise ??= createStorage().catch((err) => {
    storagePromise = undefined;
    throw err;
  });
  return storagePromise;
}

const hasEnv = (...names) => names.every((n) => Boolean(process.env[n]));

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

const auth = createAuth({
  senhaMestre: config.painel.senha,
  nomeMestre: process.env.PAINEL_USUARIO || 'Marcão',
  segredo: process.env.SESSAO_SEGREDO,
  storage: getStorage,
});
const limitador = createLimitador();
const ROTAS_PROTEGIDAS = /^\/(api\/|auth\/google$|oauth2callback$)/;
const ROTAS_ABERTAS = new Set(['POST /api/login', 'POST /api/logout']);
const ipDe = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const cookieSeguro = () => String(publicUrl() || '').startsWith('https://');

async function usuarioDe(req) {
  if (!config.painel.senha) return publicUrl() ? null : { nome: auth.nomeMestre, admin: true }; // sem senha, só libera rodando localmente
  return auth.identificar(req);
}

function exigirAdmin(req) {
  if (!req.usuario?.admin) throw new HttpError(403, `Só ${auth.nomeMestre} pode fazer isso`);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 25_000_000) throw new HttpError(413, 'Corpo da requisição muito grande');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

const paraData = (v) => (v ? parseData(MES_RE.test(v) ? `${v}-01` : v) : null);
const mesDe = (d) => String(d).slice(0, 7);

async function categoriasValidas(storage) {
  return (await contextoParser(storage)).categorias;
}

function exigir(storage, metodo) {
  if (!storage[metodo]) throw new HttpError(501, 'Não suportado neste backend');
}

function nomeCategoria(v) {
  const nome = String(v || '').trim().replace(/\s+/g, ' ');
  if (!nome || nome.length > 40) throw new HttpError(400, 'Nome da categoria deve ter de 1 a 40 caracteres');
  return nome;
}

function validarPlanejamento(body, categorias = CATEGORIAS) {
  const descricao = String(body.descricao || '').trim();
  const valor = Number(body.valor);
  const inicio = parseData(MES_RE.test(body.inicio) ? `${body.inicio}-01` : body.inicio);
  const fim = body.fim ? parseData(MES_RE.test(body.fim) ? `${body.fim}-01` : body.fim) : null;
  if (!descricao) throw new HttpError(400, 'descricao é obrigatória');
  if (!['entrada', 'saida'].includes(body.direcao)) throw new HttpError(400, 'direcao deve ser entrada ou saida');
  if (!(valor > 0)) throw new HttpError(400, 'valor deve ser maior que zero');
  if (!inicio) throw new HttpError(400, 'inicio deve ser YYYY-MM-DD ou YYYY-MM');
  return {
    descricao,
    direcao: body.direcao,
    valor: Math.round(valor * 100) / 100,
    categoria: categorias.includes(body.categoria) ? body.categoria : 'Outros',
    recorrente: body.recorrente !== false && body.recorrente !== 'false',
    inicio,
    fim,
    ...(body.responsavel ? { responsavel: String(body.responsavel).trim().slice(0, 60) } : {}),
  };
}

async function lerSaldo(storage) {
  if (!storage.getConfig) return { valor: null, atualizado_em: null };
  return JSON.parse((await storage.getConfig('saldo_atual')) || 'null') ?? { valor: null, atualizado_em: null };
}

const lerContas = (storage, mes) => carregarContas(storage, mes);

async function dadosAnalise(storage, mes, mesesAntes = 7) {
  return storage.listTransacoes({ desde: `${addMeses(mes, -mesesAntes)}-01` });
}

async function lerOrcamento(storage, mes) {
  const [transacoes, limites] = await Promise.all([dadosAnalise(storage, mes, 4), lerJsonConfig(storage, 'orcamentos')]);
  return orcamentoDoMes(transacoes, mes, limites);
}

async function status() {
  const configurado = {
    gemini: hasEnv('GEMINI_API_KEY'),
    storage: {
      sheets: hasEnv('GOOGLE_SHEETS_ID', 'GOOGLE_REFRESH_TOKEN'),
      memory: true,
    }[config.storageBackend] ?? hasEnv('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'),
    google_oauth: hasEnv('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'),
    pluggy: config.pluggy.ativo,
    telegram: config.telegram.ativo,
  };
  const out = {
    storage_backend: config.storageBackend,
    configurado,
    gmail_conectado: false,
    ultima_ingestao: null,
    redirect_uri: googleRedirectUri(),
    gemini_model: config.gemini.model,
    erro_storage: null,
    pluggy: null,
    telegram_chats: null,
  };
  if (configurado.storage) {
    try {
      const storage = await getStorage();
      out.gmail_conectado = Boolean(await resolveRefreshToken(storage));
      if (storage.getConfig) out.ultima_ingestao = JSON.parse((await storage.getConfig('ultima_ingestao')) || 'null');
      if (configurado.telegram) out.telegram_chats = (await chatsAutorizados(storage)).map((c) => c.nome);
      if (storage.getConfig && configurado.pluggy) out.pluggy = JSON.parse((await storage.getConfig('pluggy_status')) || 'null');
    } catch (err) {
      out.erro_storage = err.message;
    }
  }
  return out;
}

const routes = {
  'GET /': async (req, res) => sendHtml(res, 200, painelHtml),
  'POST /api/login': async (req, res) => {
    const ip = ipDe(req);
    if (limitador.bloqueado(ip)) throw new HttpError(429, 'Muitas tentativas. Tente de novo em 15 minutos.');
    if (!config.painel.senha) throw new HttpError(503, 'Defina a variável PAINEL_SENHA para usar o painel.');
    const { usuario, senha } = await readJson(req);
    const r = await auth.entrar(usuario, senha);
    if (!r) {
      limitador.falhou(ip);
      throw new HttpError(401, 'Usuário ou senha incorretos');
    }
    limitador.limpar(ip);
    res.setHeader('set-cookie', auth.cookie(r.token, { seguro: cookieSeguro() }));
    send(res, 200, r.usuario);
  },
  'POST /api/logout': async (req, res) => {
    res.setHeader('set-cookie', auth.cookie('', { seguro: cookieSeguro() }));
    send(res, 200, { ok: true });
  },
  'GET /api/backup': async (req, res) => {
    const zip = zipar(await gerarBackup(await getStorage()));
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${nomeBackup(new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }))}"`,
      'cache-control': 'no-store',
    });
    res.end(zip);
  },
  'GET /api/eu': async (req, res) => send(res, 200, req.usuario),
  'GET /api/usuarios': async (req, res) => send(res, 200, await auth.listar()),
  'PUT /api/usuarios': async (req, res) => {
    const { nome, senha } = await readJson(req);
    const proprio = normalizar(nome) === normalizar(req.usuario.nome);
    if (!proprio) exigirAdmin(req);
    try { await auth.definirSenha(nome, senha); } catch (e) { throw new HttpError(400, e.message); }
    send(res, 200, await auth.listar());
  },
  'DELETE /api/usuarios': async (req, res, url) => {
    exigirAdmin(req);
    await auth.remover(url.searchParams.get('nome'));
    send(res, 200, await auth.listar());
  },
  'GET /health': async (req, res) => send(res, 200, { ok: true }),
  'GET /privacidade': async (req, res) => sendHtml(res, 200, privacidadeHtml),
  'GET /api/status': async (req, res) => send(res, 200, await status()),
  'GET /api/categorias': async (req, res) => send(res, 200, await categoriasValidas(await getStorage())),

  'POST /api/categorias': async (req, res) => {
    const storage = await getStorage();
    exigir(storage, 'addCategoria');
    const nome = nomeCategoria((await readJson(req)).nome);
    await storage.addCategoria(nome);
    send(res, 201, { nome });
  },

  'PATCH /api/categorias': async (req, res, url) => {
    const storage = await getStorage();
    exigir(storage, 'renameCategoria');
    const nome = url.searchParams.get('nome');
    const novo = nomeCategoria((await readJson(req)).nome);
    if (nome === 'Outros') throw new HttpError(400, '"Outros" não pode ser renomeada');
    const atuais = await categoriasValidas(storage);
    if (!atuais.includes(nome)) throw new HttpError(404, 'Categoria não encontrada');
    if (atuais.includes(novo)) throw new HttpError(409, 'Já existe uma categoria com esse nome');
    await storage.renameCategoria(nome, novo);
    send(res, 200, { nome: novo });
  },

  'DELETE /api/categorias': async (req, res, url) => {
    const storage = await getStorage();
    exigir(storage, 'deleteCategoria');
    const nome = url.searchParams.get('nome');
    if (nome === 'Outros') throw new HttpError(400, '"Outros" não pode ser excluída');
    await storage.deleteCategoria(nome);
    send(res, 200, { ok: true });
  },

  'GET /api/saldo': async (req, res) => send(res, 200, await lerSaldo(await getStorage())),

  'PUT /api/saldo': async (req, res) => {
    const storage = await getStorage();
    exigir(storage, 'setConfig');
    const valor = Number((await readJson(req)).valor);
    if (!Number.isFinite(valor)) throw new HttpError(400, 'valor inválido');
    const saldo = { valor: Math.round(valor * 100) / 100, atualizado_em: new Date().toISOString() };
    await storage.setConfig('saldo_atual', JSON.stringify(saldo));
    send(res, 200, saldo);
  },

  'GET /api/historico': async (req, res, url) => {
    const ate = url.searchParams.get('ate') || mesCorrente();
    const meses = Number(url.searchParams.get('meses') || 12);
    if (!MES_RE.test(ate)) throw new HttpError(400, 'ate deve ser YYYY-MM');
    if (!Number.isInteger(meses) || meses < 1 || meses > 36) throw new HttpError(400, 'meses deve ser 1..36');
    const storage = await getStorage();
    const [transacoes, planejamento] = await Promise.all([
      storage.listTransacoes({ desde: `${addMeses(ate, -meses)}-01` }),
      storage.listPlanejamento(),
    ]);
    send(res, 200, serieMensal(transacoes, planejamento, ate, meses));
  },

  'POST /api/chat': async (req, res) => {
    const { mensagens } = await readJson(req);
    if (!Array.isArray(mensagens) || !mensagens.length) throw new HttpError(400, 'mensagens é obrigatório');
    const storage = await getStorage();
    const mesAtual = mesCorrente();
    const [transacoes, planejamento, saldo, metas] = await Promise.all([
      storage.listTransacoes({ desde: `${addMeses(mesAtual, -7)}-01` }),
      storage.listPlanejamento(),
      lerSaldo(storage),
      lerMetas(storage),
    ]);
    const contexto = montarContexto({ transacoes, planejamento, mesAtual, saldoAtual: saldo.valor ?? 0, metas });
    send(res, 200, { resposta: await responderChat({ mensagens, contexto }) });
  },

  'GET /api/relatorio': async (req, res, url) => {
    const mes = url.searchParams.get('mes') || mesCorrente();
    const meses = Number(url.searchParams.get('meses') || 6);
    const saldoParam = url.searchParams.get('saldo_inicial');
    if (!MES_RE.test(mes)) throw new HttpError(400, 'mes deve ser YYYY-MM');
    if (!Number.isInteger(meses) || meses < 1 || meses > 36) throw new HttpError(400, 'meses deve ser 1..36');
    const rel = await gerarRelatorio({
      mes,
      meses,
      saldoInicial: saldoParam ? Number(saldoParam) : (await lerSaldo(await getStorage())).valor ?? undefined,
      storage: await getStorage(),
    });
    send(res, 200, rel);
  },

  'POST /telegram/webhook': async (req, res) => {
    if (!telegram || req.headers['x-telegram-bot-api-secret-token'] !== segredoWebhook(config.telegram.token)) throw new HttpError(404, 'Não encontrado');
    const update = await readJson(req);
    send(res, 200, { ok: true });
    const storage = await getStorage();
    processarUpdate(update, { storage, tg: telegram }).catch((e) => {
      console.error('Telegram:', e);
      const chatId = update.message?.chat?.id;
      if (chatId) telegram.enviar(chatId, `Não consegui processar: ${e.message}`).catch(() => {});
    });
  },

  'POST /api/telegram/teste': async (req, res) => {
    if (!telegram) throw new HttpError(400, 'Telegram não configurado (TELEGRAM_BOT_TOKEN)');
    const storage = await getStorage();
    const chats = await chatsAutorizados(storage);
    if (!chats.length) throw new HttpError(400, 'Nenhum chat conectado. Mande /start <senha> para o bot.');
    for (const c of chats) await telegram.enviar(c.id, 'Teste do gastos-sync: os avisos vão chegar aqui.');
    send(res, 200, { enviados: chats.length });
  },

  'GET /api/contas': async (req, res, url) => {
    const mes = url.searchParams.get('mes') || mesCorrente();
    if (!MES_RE.test(mes)) throw new HttpError(400, 'mes deve ser YYYY-MM');
    send(res, 200, await lerContas(await getStorage(), mes));
  },

  'PUT /api/contas/pago': async (req, res) => {
    const storage = await getStorage();
    exigir(storage, 'setConfig');
    const { mes, chave, pago } = await readJson(req);
    if (!MES_RE.test(mes)) throw new HttpError(400, 'mes deve ser YYYY-MM');
    if (!/^(fixo|cartao):.{1,120}$/.test(chave || '')) throw new HttpError(400, 'chave inválida');
    const pagos = await lerJsonConfig(storage, 'contas_pagas');
    pagos[mes] = pagos[mes] || {};
    if (pago === false) delete pagos[mes][chave];
    else pagos[mes][chave] = new Date().toISOString();
    if (!Object.keys(pagos[mes]).length) delete pagos[mes];
    await storage.setConfig('contas_pagas', JSON.stringify(pagos));
    send(res, 200, await lerContas(storage, mes));
  },

  'PUT /api/contas/dia': async (req, res) => {
    const storage = await getStorage();
    exigir(storage, 'setConfig');
    const { mes, chave, dia } = await readJson(req);
    if (!/^fixo:.{1,120}$/.test(chave || '')) throw new HttpError(400, 'chave inválida');
    const d = dia == null || dia === '' ? null : Number(dia);
    if (d !== null && !(Number.isInteger(d) && d >= 1 && d <= 31)) throw new HttpError(400, 'dia deve ser 1..31');
    const dias = await lerJsonConfig(storage, 'contas_dias');
    if (d === null) delete dias[chave];
    else dias[chave] = d;
    await storage.setConfig('contas_dias', JSON.stringify(dias));
    send(res, 200, MES_RE.test(mes) ? await lerContas(storage, mes) : { ok: true });
  },

  'GET /api/orcamentos': async (req, res, url) => {
    const mes = url.searchParams.get('mes') || mesCorrente();
    if (!MES_RE.test(mes)) throw new HttpError(400, 'mes deve ser YYYY-MM');
    send(res, 200, await lerOrcamento(await getStorage(), mes));
  },

  // { limites: { Categoria: valor|null } } — valor vazio/0 remove a meta.
  'PUT /api/orcamentos': async (req, res) => {
    const storage = await getStorage();
    exigir(storage, 'setConfig');
    const { mes, limites } = await readJson(req);
    if (!limites || typeof limites !== 'object') throw new HttpError(400, 'limites é obrigatório');
    const validas = await categoriasValidas(storage);
    const atuais = await lerJsonConfig(storage, 'orcamentos');
    for (const [cat, v] of Object.entries(limites)) {
      if (!validas.includes(cat)) throw new HttpError(400, `Categoria inválida: ${cat}`);
      const n = v == null || v === '' ? 0 : Number(v);
      if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `Valor inválido para ${cat}`);
      if (n > 0) atuais[cat] = Math.round(n * 100) / 100;
      else delete atuais[cat];
    }
    await storage.setConfig('orcamentos', JSON.stringify(atuais));
    send(res, 200, await lerOrcamento(storage, MES_RE.test(mes || '') ? mes : mesCorrente()));
  },

  'GET /api/analises': async (req, res, url) => {
    const mes = url.searchParams.get('mes') || mesCorrente();
    if (!MES_RE.test(mes)) throw new HttpError(400, 'mes deve ser YYYY-MM');
    const storage = await getStorage();
    const [transacoes, plano] = await Promise.all([dadosAnalise(storage, mes), lerJsonConfig(storage, 'plano_corte')]);
    send(res, 200, { assinaturas: assinaturas(transacoes, mes), conferencia: conferencia(transacoes, mes), plano: plano.acoes ? plano : null });
  },

  'GET /api/metas': async (req, res) => {
    send(res, 200, resumoMetas(await lerMetas(await getStorage()), mesCorrente()));
  },

  // { metas: [{ id?, nome, alvo, guardado, prazo: 'YYYY-MM' }] } substitui a lista inteira.
  'PUT /api/metas': async (req, res) => {
    const storage = await getStorage();
    exigir(storage, 'setConfig');
    const { metas } = await readJson(req);
    let validas;
    try { validas = validarMetas(metas); } catch (e) { throw new HttpError(400, e.message); }
    await storage.setConfig('metas_poupanca', JSON.stringify(validas));
    send(res, 200, resumoMetas(validas, mesCorrente()));
  },

  'GET /api/fechamento': async (req, res, url) => {
    const mes = url.searchParams.get('mes') || addMeses(mesCorrente(), -1);
    if (!MES_RE.test(mes)) throw new HttpError(400, 'mes deve ser YYYY-MM');
    send(res, 200, await gerarFechamento(await getStorage(), mes));
  },

  'GET /api/pessoas': async (req, res, url) => {
    const mes = url.searchParams.get('mes') || mesCorrente();
    if (!MES_RE.test(mes)) throw new HttpError(400, 'mes deve ser YYYY-MM');
    const storage = await getStorage();
    const [transacoes, planejamento] = await Promise.all([dadosAnalise(storage, mes, 1), storage.listPlanejamento()]);
    send(res, 200, gastosPorPessoa(transacoes, planejamento, mes));
  },

  'GET /api/revisao': async (req, res, url) => {
    const mes = url.searchParams.get('mes') || mesCorrente();
    if (!MES_RE.test(mes)) throw new HttpError(400, 'mes deve ser YYYY-MM');
    const storage = await getStorage();
    const [transacoes, revisados] = await Promise.all([dadosAnalise(storage, mes), lerRevisados(storage)]);
    send(res, 200, { mes, itens: caixaRevisao(transacoes, mes, revisados) });
  },

  // { ids: [...] } marca como conferido (sai da caixa de revisão).
  'POST /api/revisao/ok': async (req, res) => {
    const storage = await getStorage();
    exigir(storage, 'setConfig');
    const { ids } = await readJson(req);
    if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'ids é obrigatório');
    await marcarRevisados(storage, ids);
    send(res, 200, { ok: true });
  },

  'POST /api/plano-corte': async (req, res) => {
    const storage = await getStorage();
    const mesAtual = mesCorrente();
    const [transacoes, planejamento, saldo, limites, categorias, metas] = await Promise.all([
      dadosAnalise(storage, mesAtual),
      storage.listPlanejamento(),
      lerSaldo(storage),
      lerJsonConfig(storage, 'orcamentos'),
      categoriasValidas(storage),
      lerMetas(storage),
    ]);
    const plano = await gerarPlano({ transacoes, planejamento, mesAtual, saldoAtual: saldo.valor ?? 0, limites, categorias, metas });
    if (storage.setConfig) await storage.setConfig('plano_corte', JSON.stringify(plano));
    send(res, 200, plano);
  },

  'GET /api/transacoes': async (req, res, url) => {
    const mes = url.searchParams.get('mes') || mesCorrente();
    if (!MES_RE.test(mes)) throw new HttpError(400, 'mes deve ser YYYY-MM');
    const storage = await getStorage();
    const todas = await storage.listTransacoes({ desde: `${mes}-01` });
    send(
      res,
      200,
      todas.filter((t) => String(t.data).startsWith(mes)).sort((a, b) => (a.data < b.data ? 1 : -1)),
    );
  },

  // Troca a categoria de um lançamento; com "lembrar", aplica a todos do mesmo estabelecimento
  // (antigos e futuros).
  'PATCH /api/transacoes': async (req, res, url) => {
    const storage = await getStorage();
    exigir(storage, 'updateTransacoes');
    const id = url.searchParams.get('id');
    const body = await readJson(req);
    if ('responsavel' in body && body.categoria === undefined) {
      const pessoas = pessoasDe(await storage.listPlanejamento());
      const responsavel = body.responsavel === CASAL ? null : body.responsavel || null;
      if (responsavel && !pessoas.includes(responsavel)) throw new HttpError(400, 'Pessoa inválida');
      await storage.updateTransacoes([id], { responsavel });
      return send(res, 200, { atualizadas: 1 });
    }
    if (!(await categoriasValidas(storage)).includes(body.categoria)) throw new HttpError(400, 'Categoria inválida');
    const todas = await storage.listTransacoes();
    const alvo = todas.find((t) => String(t.id) === String(id));
    if (!alvo) throw new HttpError(404, 'Transação não encontrada');
    let ids = [alvo.id];
    if (body.lembrar) {
      exigir(storage, 'saveRegra');
      const chave = chaveEstabelecimento(alvo.estabelecimento);
      await storage.saveRegra(chave, body.categoria);
      ids = todas.filter((t) => chaveEstabelecimento(t.estabelecimento) === chave).map((t) => t.id);
    }
    await storage.updateTransacoes(ids, { categoria: body.categoria });
    send(res, 200, { atualizadas: ids.length });
  },

  'DELETE /api/transacoes': async (req, res, url) => {
    const storage = await getStorage();
    if (!storage.deleteTransacao) throw new HttpError(501, 'Não suportado neste backend');
    await storage.deleteTransacao(url.searchParams.get('id'));
    send(res, 200, { ok: true });
  },

  'GET /api/planejamento': async (req, res) => send(res, 200, await (await getStorage()).listPlanejamento()),

  'POST /api/planejamento': async (req, res) => {
    const storage = await getStorage();
    const item = validarPlanejamento(await readJson(req), await categoriasValidas(storage));
    send(res, 201, await storage.addPlanejamento(item));
  },

  // Edita um item. Com "a_partir_de" (YYYY-MM) posterior ao início, preserva o histórico:
  // o item atual termina no mês anterior e um novo começa nesse mês com os valores editados.
  // "fim" (YYYY-MM) encerra o item: último mês em que ele conta.
  'PATCH /api/planejamento': async (req, res, url) => {
    const storage = await getStorage();
    exigir(storage, 'updatePlanejamento');
    const id = url.searchParams.get('id');
    const atual = (await storage.listPlanejamento()).find((p) => String(p.id) === String(id));
    if (!atual) throw new HttpError(404, 'Item não encontrado');
    const body = await readJson(req);
    const fimInformado = 'fim' in body;
    const mesclado = validarPlanejamento(
      {
        ...atual,
        ...body,
        inicio: mesDe(atual.inicio),
        fim: fimInformado ? body.fim : atual.fim,
      },
      await categoriasValidas(storage),
    );
    const aPartir = body.a_partir_de;
    if (aPartir && !MES_RE.test(aPartir)) throw new HttpError(400, 'a_partir_de deve ser YYYY-MM');
    if (aPartir && aPartir > mesDe(atual.inicio)) {
      if (atual.fim && mesDe(atual.fim) < aPartir) throw new HttpError(400, 'Este item já terminou antes desse mês');
      await storage.updatePlanejamento(atual.id, { fim: paraData(addMeses(aPartir, -1)) });
      const novo = await storage.addPlanejamento({ ...mesclado, inicio: paraData(aPartir) });
      return send(res, 200, novo);
    }
    if (mesclado.fim && mesDe(mesclado.fim) < mesDe(mesclado.inicio)) {
      throw new HttpError(400, 'O fim não pode ser antes do início');
    }
    const { descricao, valor, categoria, recorrente, fim, responsavel } = mesclado;
    send(res, 200, await storage.updatePlanejamento(atual.id, { descricao, valor, categoria, recorrente, fim, ...(responsavel ? { responsavel } : {}) }));
  },

  'DELETE /api/planejamento': async (req, res, url) => {
    const storage = await getStorage();
    if (!storage.deletePlanejamento) throw new HttpError(501, 'Não suportado neste backend');
    await storage.deletePlanejamento(url.searchParams.get('id'));
    send(res, 200, { ok: true });
  },

  'POST /api/parse': async (req, res) => {
    const body = await readJson(req);
    const texto = String(body.texto || '').trim();
    const anexos = (Array.isArray(body.anexos) ? body.anexos : [])
      .filter((a) => a?.data && a.mimeType === 'application/pdf')
      .slice(0, 3)
      .map((a) => ({ filename: String(a.filename || 'anexo.pdf'), mimeType: a.mimeType, data: String(a.data) }));
    if (!texto && !anexos.length) throw new HttpError(400, 'Cole o texto do e-mail ou anexe um PDF');
    const email = {
      id: null,
      from: String(body.remetente || ''),
      subject: String(body.assunto || 'E-mail colado no painel'),
      date: new Date().toISOString(),
      body: /<html|<body|<table|<div/i.test(texto) ? htmlToText(texto) : texto,
      anexos,
    };
    const storage = await getStorage();
    const transacoes = await parseEmail(email, undefined, await contextoParser(storage));
    let salvas = null;
    if (body.salvar && transacoes.length) salvas = await storage.saveTransacoes(transacoes);
    send(res, 200, { transacoes, salvas });
  },

  'POST /api/ingest': async (req, res) => {
    const body = await readJson(req);
    if (ingestaoEmAndamento) throw new HttpError(409, 'Já existe uma ingestão em andamento');
    ingestaoEmAndamento = true;
    const logs = [];
    try {
      const storage = await getStorage();
      const dryRun = body.dryRun === true;
      const r = await ingestNow({ dryRun, storage, log: (l) => logs.push(l) });
      let openFinance = null;
      if (config.pluggy.ativo) {
        logs.push('Open Finance:');
        openFinance = await syncPluggy({ storage, dryRun, log: (l) => logs.push(l) }).catch((e) => {
          logs.push(`! Open Finance falhou: ${e.message}`);
          return null;
        });
        if (openFinance) r.transacoes.push(...openFinance.transacoes);
      }
      const resumo = {
        quando: new Date().toISOString(),
        simulacao: dryRun,
        emails: r.emails,
        transacoes: r.transacoes.length,
        inseridas: r.inserted.length,
        duplicadas: r.skipped,
        falhas: r.falhas.length,
        open_finance: openFinance && { novas: openFinance.novas, saldo: openFinance.saldo },
      };
      if (!dryRun && storage.setConfig) await storage.setConfig('ultima_ingestao', JSON.stringify(resumo));
      if (!dryRun && telegram) {
        await enviarAlertas({ storage, tg: telegram, log: (l) => logs.push(l) })
          .then((a) => a.enviados && logs.push(`Telegram: ${a.enviados} aviso(s) enviado(s)`))
          .catch((e) => logs.push(`! Avisos do Telegram falharam: ${e.message}`));
      }
      send(res, 200, { ...resumo, logs, itens: dryRun ? r.transacoes : r.inserted, erros: r.falhas });
    } catch (err) {
      send(res, 500, { erro: err.message, logs });
    } finally {
      ingestaoEmAndamento = false;
    }
  },

  // Importa só o Open Finance; "dias" permite buscar o histórico (a Pluggy guarda até 12 meses).
  'POST /api/pluggy/sync': async (req, res) => {
    if (!config.pluggy.ativo) throw new HttpError(400, 'Open Finance não configurado (PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_ITEM_IDS)');
    const body = await readJson(req);
    const dias = body.dias == null ? undefined : Number(body.dias);
    if (dias !== undefined && !(Number.isInteger(dias) && dias >= 1 && dias <= 400)) throw new HttpError(400, 'dias deve ser 1..400');
    const logs = [];
    const r = await syncPluggy({ storage: await getStorage(), dryRun: body.dryRun === true, dias, log: (l) => logs.push(l) });
    send(res, 200, { ...r, logs });
  },

  'GET /auth/google': async (req, res) => {
    if (!hasEnv('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET')) {
      throw new HttpError(400, 'Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET');
    }
    const state = randomBytes(16).toString('hex');
    oauthStates.set(state, Date.now() + 10 * 60_000);
    const url = createOAuthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GMAIL_SCOPES,
      state,
    });
    res.writeHead(302, { location: url });
    res.end();
  },

  'GET /oauth2callback': async (req, res, url) => {
    const state = url.searchParams.get('state');
    const expira = oauthStates.get(state);
    oauthStates.delete(state);
    if (!expira || expira < Date.now()) throw new HttpError(400, 'Estado OAuth inválido ou expirado; tente de novo.');
    const code = url.searchParams.get('code');
    if (!code) throw new HttpError(400, url.searchParams.get('error') || 'Código OAuth ausente');
    const { tokens } = await createOAuthClient().getToken(code);
    if (!tokens.refresh_token) throw new HttpError(400, 'O Google não retornou refresh token; tente de novo.');
    const storage = await getStorage();
    if (!storage.setConfig) throw new HttpError(501, 'Use GOOGLE_REFRESH_TOKEN no ambiente para este backend');
    await storage.setConfig('google_refresh_token', tokens.refresh_token);
    res.writeHead(302, { location: '/?gmail=conectado' });
    res.end();
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    const rota = `${req.method} ${url.pathname}`;
    if (ROTAS_PROTEGIDAS.test(url.pathname) && !ROTAS_ABERTAS.has(rota)) {
      req.usuario = await usuarioDe(req);
      if (!req.usuario) {
        if (!url.pathname.startsWith('/api/')) {
          res.writeHead(302, { location: '/' });
          return res.end();
        }
        return send(res, 401, { erro: 'Faça login para continuar', login: true });
      }
    }
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) {
      if (req.method === 'GET' && !url.pathname.startsWith('/api/') && (await sendAsset(res, url.pathname))) return;
      return send(res, 404, { erro: 'Rota não encontrada' });
    }
    await handler(req, res, url);
  } catch (err) {
    const statusCode = err.status || 500;
    if (statusCode >= 500) console.error(err);
    if (!res.headersSent) send(res, statusCode, { erro: err.message });
  }
});

server.listen(config.summary.port, () => {
  console.log(`Painel em http://localhost:${config.summary.port}`);
  if (telegram && publicUrl()) {
    telegram
      .configurarWebhook(`${publicUrl()}/telegram/webhook`, segredoWebhook(config.telegram.token))
      .then(() => telegram.configurarComandos())
      .then(() => console.log('Telegram: webhook configurado'))
      .catch((e) => console.error('Telegram:', e.message));
  }
});
