import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const COOKIE = 'gs_sessao';
const DURACAO_MS = 90 * 24 * 3600_000;
const CHAVE_USUARIOS = 'usuarios';

export const normalizar = (nome) => String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

const iguais = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

export function hashSenha(senha, sal = randomBytes(16).toString('hex')) {
  return `${sal}:${scryptSync(String(senha), sal, 32).toString('hex')}`;
}

export function confereSenha(senha, hash) {
  const [sal, h] = String(hash || '').split(':');
  if (!sal || !h) return false;
  return iguais(hashSenha(senha, sal).split(':')[1], h);
}

// Usuários: o principal entra com PAINEL_SENHA (admin); os demais ficam em app_config com a senha em scrypt.
export function createAuth({ senhaMestre, nomeMestre = 'Marcão', segredo, storage }) {
  const chave = createHash('sha256').update(`gastos-sync-sessao|${segredo || senhaMestre || ''}`).digest();
  const versaoMestre = createHash('sha256').update(String(senhaMestre || '')).digest('hex').slice(0, 12);
  let cache = null;

  async function usuarios() {
    if (cache && cache.ate > Date.now()) return cache.lista;
    const s = await storage();
    const lista = s.getConfig ? JSON.parse((await s.getConfig(CHAVE_USUARIOS)) || '[]') : [];
    cache = { lista, ate: Date.now() + 60_000 };
    return lista;
  }

  async function salvar(lista) {
    const s = await storage();
    await s.setConfig(CHAVE_USUARIOS, JSON.stringify(lista));
    cache = { lista, ate: Date.now() + 60_000 };
  }

  const versao = (u) => (u.admin ? versaoMestre : String(u.hash).slice(-12));
  const assinar = (dados) => createHmac('sha256', chave).update(dados).digest('base64url');

  function token(u) {
    const dados = Buffer.from(JSON.stringify({ n: u.nome, v: versao(u), e: Date.now() + DURACAO_MS })).toString('base64url');
    return `${dados}.${assinar(dados)}`;
  }

  async function porNome(nome) {
    if (normalizar(nome) === normalizar(nomeMestre)) return { nome: nomeMestre, admin: true };
    const u = (await usuarios()).find((x) => normalizar(x.nome) === normalizar(nome));
    return u ? { ...u, admin: false } : null;
  }

  async function entrar(nome, senha) {
    const u = await porNome(nome);
    if (!u) return null;
    const ok = u.admin ? iguais(senha, senhaMestre) : confereSenha(senha, u.hash);
    return ok ? { usuario: { nome: u.nome, admin: u.admin }, token: token(u) } : null;
  }

  async function daSessao(valor) {
    const [dados, assinatura] = String(valor || '').split('.');
    if (!dados || !assinatura || !iguais(assinar(dados), assinatura)) return null;
    let p;
    try { p = JSON.parse(Buffer.from(dados, 'base64url').toString('utf8')); } catch { return null; }
    if (!p.e || p.e < Date.now()) return null;
    const u = await porNome(p.n);
    if (!u || versao(u) !== p.v) return null;
    return { nome: u.nome, admin: u.admin };
  }

  function doBasic(header) {
    const [scheme, encoded] = String(header || '').split(' ');
    if (scheme !== 'Basic' || !encoded) return null;
    const senha = Buffer.from(encoded, 'base64').toString('utf8').split(':').slice(1).join(':');
    return iguais(senha, senhaMestre) ? { nome: nomeMestre, admin: true } : null;
  }

  return {
    COOKIE,
    nomeMestre,
    async identificar(req) {
      return doBasic(req.headers.authorization) || daSessao(lerCookie(req, COOKIE));
    },
    entrar,
    cookie(valor, { seguro }) {
      const base = `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Lax${seguro ? '; Secure' : ''}`;
      return valor ? `${base}; Max-Age=${DURACAO_MS / 1000}` : `${base}; Max-Age=0`;
    },
    async listar() {
      return [{ nome: nomeMestre, admin: true }, ...(await usuarios()).map((u) => ({ nome: u.nome, admin: false }))];
    },
    async definirSenha(nome, senha) {
      nome = String(nome || '').trim();
      if (!nome || nome.length > 40) throw new Error('Nome inválido');
      if (normalizar(nome) === normalizar(nomeMestre)) throw new Error(`A senha de ${nomeMestre} é a PAINEL_SENHA do servidor`);
      if (String(senha || '').length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres');
      const lista = (await usuarios()).filter((u) => normalizar(u.nome) !== normalizar(nome));
      await salvar([...lista, { nome, hash: hashSenha(senha) }]);
    },
    async remover(nome) {
      await salvar((await usuarios()).filter((u) => normalizar(u.nome) !== normalizar(nome)));
    },
  };
}

export function lerCookie(req, nome) {
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return v.join('=');
  }
  return null;
}

// Limite simples de tentativas de login por IP.
export function createLimitador({ max = 10, janelaMs = 15 * 60_000 } = {}) {
  const falhas = new Map();
  return {
    bloqueado(ip) {
      const f = falhas.get(ip);
      if (f && f.ate < Date.now()) falhas.delete(ip);
      return (falhas.get(ip)?.n || 0) >= max;
    },
    falhou(ip) {
      const f = falhas.get(ip) && falhas.get(ip).ate > Date.now() ? falhas.get(ip) : { n: 0, ate: Date.now() + janelaMs };
      f.n++;
      falhas.set(ip, f);
    },
    limpar(ip) { falhas.delete(ip); },
  };
}
