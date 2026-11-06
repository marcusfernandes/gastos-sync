import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CATEGORIAS, config, googleRedirectUri, publicUrl } from './config.js';
import { createOAuthClient, GMAIL_SCOPES, htmlToText, resolveRefreshToken } from './gmail/client.js';
import { ingestNow } from './ingest.js';
import { parseEmail } from './parser/gemini.js';
import { chaveEstabelecimento, parseData } from './parser/normalize.js';
import { contextoParser, createStorage } from './storage/index.js';
import { addMeses } from './summary/forecast.js';
import { gerarRelatorio, mesCorrente } from './summary/service.js';

const MES_RE = /^\d{4}-\d{2}$/;
const PUBLIC_PATHS = new Set(['/health', '/privacidade']);
const painelHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
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
    gemini_model: config.gemini.model,
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

  // Troca a categoria de um lançamento; com "lembrar", aplica a todos do mesmo estabelecimento
  // (antigos e futuros).
  'PATCH /api/transacoes': async (req, res, url) => {
    const storage = await getStorage();
    exigir(storage, 'updateTransacoes');
    const id = url.searchParams.get('id');
    const body = await readJson(req);
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
