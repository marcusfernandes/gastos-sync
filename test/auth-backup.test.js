import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, createLimitador, confereSenha, hashSenha } from '../src/auth.js';
import { gerarBackup, paraCsv, zipar } from '../src/backup.js';
import { createMemoryStorage } from '../src/storage/memory.js';

const req = (headers) => ({ headers });

test('auth: senha mestre, usuária com senha própria, sessão assinada e troca de senha derruba a sessão', async () => {
  const storage = createMemoryStorage();
  const auth = createAuth({ senhaMestre: 'mestre123', storage: async () => storage });
  assert.equal(await auth.entrar('marcao', 'errada'), null);
  const m = await auth.entrar('Marcão', 'mestre123');
  assert.deepEqual(m.usuario, { nome: 'Marcão', admin: true });
  assert.deepEqual(await auth.identificar(req({ cookie: `x=1; gs_sessao=${m.token}` })), { nome: 'Marcão', admin: true });
  assert.deepEqual(await auth.identificar(req({ authorization: `Basic ${Buffer.from('actions:mestre123').toString('base64')}` })), { nome: 'Marcão', admin: true });

  await assert.rejects(auth.definirSenha('Becca', 'curta'));
  await auth.definirSenha('Becca', 'senhaDaBecca');
  const b = await auth.entrar('becca', 'senhaDaBecca');
  assert.deepEqual(b.usuario, { nome: 'Becca', admin: false });
  assert.deepEqual(await auth.identificar(req({ cookie: `gs_sessao=${b.token}` })), { nome: 'Becca', admin: false });
  assert.equal(await auth.identificar(req({ cookie: `gs_sessao=${b.token.slice(0, -2)}xx` })), null);

  await auth.definirSenha('Becca', 'outraSenha1');
  assert.equal(await auth.identificar(req({ cookie: `gs_sessao=${b.token}` })), null);
  await auth.remover('Becca');
  assert.equal(await auth.entrar('Becca', 'outraSenha1'), null);
  assert.ok(confereSenha('abc', hashSenha('abc')));
});

test('limitador: bloqueia depois de muitas falhas', () => {
  const l = createLimitador({ max: 2 });
  l.falhou('1'); assert.equal(l.bloqueado('1'), false);
  l.falhou('1'); assert.equal(l.bloqueado('1'), true);
  l.limpar('1'); assert.equal(l.bloqueado('1'), false);
});

test('backup: CSV no padrão BR e zip válido, sem segredos', async () => {
  assert.equal(paraCsv([{ a: 1.5, d: '2026-11-02', t: 'x;y' }]), '\uFEFFa;d;t\r\n1,5;02/11/2026;"x;y"\r\n');
  const storage = createMemoryStorage({ transacoes: [{ id: 1, data: '2026-11-02', valor: 10, estabelecimento: 'A', categoria: 'Outros', tipo: 'compra' }] });
  await storage.setConfig('google_refresh_token', 'segredo');
  await storage.setConfig('orcamentos', JSON.stringify({ Lazer: 500 }));
  const arquivos = await gerarBackup(storage);
  const conf = JSON.parse(arquivos.find((a) => a.nome === 'configuracoes.json').conteudo);
  assert.deepEqual(conf, { orcamentos: { Lazer: 500 } });
  const zip = zipar(arquivos);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt16LE(zip.length - 12), arquivos.length);
});
