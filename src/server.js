import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CATEGORIAS, config, googleRedirectUri, publicUrl } from './config.js';
import { createOAuthClient, GMAIL_SCOPES, htmlToText, resolveRefreshToken } from './gmail/client.js';
import { ingestNow } from './ingest.js';
import { parseEmail } from './parser/gemini.js';
import { parseData } from './parser/normalize.js';
import { createStorage } from './storage/index.js';
import { gerarRelatorio, mesCorrente } from './summary/service.js';

const MES_RE = /^\d{4}-\d{2}$/;
const PUBLIC_PATHS = new Set(['/health']);
const painelHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
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

function autorizado(req) {
  const senha = config.painel.senha;
  if (!senha) return !publicUrl(); // sem senha, só libera rodando localmente
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  const informada = Buffer.from(Buffer.from(encoded, 'base64').toString('utf8').split(':').slice(1).join(':'));
  const esperada = Buffer.from(senha);
  return informada.length === esperada.length && timingSafeEqual(informada, esperada);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new HttpError(413, 'Corpo da requisição muito grande');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

function validarPlanejamento(body) {
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
    categoria: CATEGORIAS.includes(body.categoria) ? body.categoria : 'Outros',
    recorrente: body.recorrente !== false && body.recorrente !== 'false',
    inicio,
    fim,
  };
}

async function status() {
  const configurado = {
    gemini: hasEnv('GEMINI_API_KEY'),
    storage: {
      sheets: hasEnv('GOOGLE_SHEETS_ID', 'GOOGLE_REFRESH_TOKEN'),
      memory: true,
    }[config.storageBackend] ?? hasEnv('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'),
    google_oauth: hasEnv('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'),
  };
  const out = {
    storage_backend: config.storageBackend,
    configurado,
    gmail_conectado: false,
    ultima_ingestao: null,
    redirect_uri: googleRedirectUri(),
    gemini_model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    erro_storage: null,
  };
  if (configurado.storage) {
    try {
      const storage = await getStorage();
      out.gmail_conectado = Boolean(await resolveRefreshToken(storage));
      if (storage.getConfig) out.ultima_ingestao = JSON.parse((await storage.getConfig('ultima_ingestao')) || 'null');
    } catch (err) {
      out.erro_storage = err.message;
    }
  }
  return out;
}

const routes = {
  'GET /': async (req, res) => sendHtml(res, 200, painelHtml),
  'GET /health': async (req, res) => send(res, 200, { ok: true }),
  'GET /api/status': async (req, res) => send(res, 200, await status()),
  'GET /api/categorias': async (req, res) => send(res, 200, CATEGORIAS),

  'GET /api/relatorio': async (req, res, url) => {
    const mes = url.searchParams.get('mes') || mesCorrente();
    const meses = Number(url.searchParams.get('meses') || 6);
    const saldoParam = url.searchParams.get('saldo_inicial');
    if (!MES_RE.test(mes)) throw new HttpError(400, 'mes deve ser YYYY-MM');
    if (!Number.isInteger(meses) || meses < 1 || meses > 36) throw new HttpError(400, 'meses deve ser 1..36');
    const rel = await gerarRelatorio({
      mes,
      meses,
      saldoInicial: saldoParam ? Number(saldoParam) : undefined,
      storage: await getStorage(),
    });
    send(res, 200, rel);
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

  'DELETE /api/transacoes': async (req, res, url) => {
    const storage = await getStorage();
    if (!storage.deleteTransacao) throw new HttpError(501, 'Não suportado neste backend');
    await storage.deleteTransacao(url.searchParams.get('id'));
    send(res, 200, { ok: true });
  },

  'GET /api/planejamento': async (req, res) => send(res, 200, await (await getStorage()).listPlanejamento()),

  'POST /api/planejamento': async (req, res) => {
    const item = validarPlanejamento(await readJson(req));
    send(res, 201, await (await getStorage()).addPlanejamento(item));
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
    if (!texto) throw new HttpError(400, 'Cole o texto do e-mail no campo "texto"');
    const email = {
      id: null,
      from: String(body.remetente || ''),
      subject: String(body.assunto || 'E-mail colado no painel'),
      date: new Date().toISOString(),
      body: /<html|<body|<table|<div/i.test(texto) ? htmlToText(texto) : texto,
    };
    const transacoes = await parseEmail(email);
    let salvas = null;
    if (body.salvar && transacoes.length) salvas = await (await getStorage()).saveTransacoes(transacoes);
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
      const resumo = {
        quando: new Date().toISOString(),
        simulacao: dryRun,
        emails: r.emails,
        transacoes: r.transacoes.length,
        inseridas: r.inserted.length,
        duplicadas: r.skipped,
        falhas: r.falhas.length,
      };
      if (!dryRun && storage.setConfig) await storage.setConfig('ultima_ingestao', JSON.stringify(resumo));
      send(res, 200, { ...resumo, logs, itens: dryRun ? r.transacoes : r.inserted, erros: r.falhas });
    } catch (err) {
      send(res, 500, { erro: err.message, logs });
    } finally {
      ingestaoEmAndamento = false;
    }
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
    if (!PUBLIC_PATHS.has(url.pathname) && !autorizado(req)) {
      if (!config.painel.senha) return sendHtml(res, 503, 'Defina a variável PAINEL_SENHA para usar o painel.');
      res.writeHead(401, { 'www-authenticate': 'Basic realm="gastos-sync", charset="UTF-8"' });
      return res.end('Autenticação necessária');
    }
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return send(res, 404, { erro: 'Rota não encontrada' });
    await handler(req, res, url);
  } catch (err) {
    const statusCode = err.status || 500;
    if (statusCode >= 500) console.error(err);
    if (!res.headersSent) send(res, statusCode, { erro: err.message });
  }
});

server.listen(config.summary.port, () => {
  console.log(`Painel em http://localhost:${config.summary.port}`);
});
