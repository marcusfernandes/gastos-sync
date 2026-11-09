import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoDoItem, mapFatura, mapTransacao, nomeConta, semEstornos, titularPrincipal } from '../src/pluggy/map.js';
import { cartaoDe } from '../src/parser/normalize.js';
import { faturasSemDetalhe } from '../src/summary/forecast.js';
import { semDuplicatasCruzadas } from '../src/dedupe.js';
import { syncPluggy } from '../src/pluggy/sync.js';
import { createMemoryStorage } from '../src/storage/memory.js';

const item = { connector: { name: 'Itaú' } };
const cartao = { id: 'c1', type: 'CREDIT', subtype: 'CREDIT_CARD', name: 'Personnalité Visa Infinite', number: '1234', creditData: { balanceDueDate: '2026-11-15' } };
const conta = { id: 'b1', type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'Conta corrente', balance: 1500.5 };
const hoje = '2026-11-08';

test('compra parcelada no cartão vira compra com parcela e vencimento da fatura', () => {
  const faturasPorId = new Map([['f1', { id: 'f1', dueDate: '2026-12-15T00:00:00.000Z' }]]);
  const t = mapTransacao(
    { id: 't1', date: '2026-11-02T00:00:00.000Z', description: 'MAGALU 04/10', amount: 199.9, status: 'POSTED', creditCardMetadata: { installmentNumber: 4, totalInstallments: 10, billId: 'f1' } },
    cartao,
    { nome: 'Itaú', faturasPorId, hoje },
  );
  assert.equal(t.tipo, 'compra');
  assert.equal(t.estabelecimento, 'MAGALU (parcela 4/10)');
  assert.equal(t.parcela_atual, 4);
  assert.equal(t.vencimento, '2026-12-15');
  assert.equal(t.conta_ou_cartao, 'Itaú');
  assert.equal(t.origem_email_id, 'pluggy:t1');
});

test('sem fatura conhecida usa billForecastDate com o dia de vencimento do cartão', () => {
  const t = mapTransacao({ id: 't2', date: '2026-11-03', description: 'IFOOD', amount: 50, status: 'PENDING', creditCardMetadata: { billForecastDate: '2026-12' } }, cartao, { nome: 'Itaú', hoje });
  assert.equal(t.vencimento, '2026-12-15');
});

test('pagamento de fatura, estorno, parcela futura e créditos que não são Pix ficam de fora', () => {
  assert.equal(mapTransacao({ id: 'a', date: '2026-11-01', description: 'PAGAMENTO', amount: -900 }, cartao, { nome: 'Itaú', hoje }), null);
  assert.equal(mapTransacao({ id: 'b', date: '2027-01-02', description: 'LOJA', amount: 100, status: 'PENDING' }, cartao, { nome: 'Itaú', hoje }), null);
  assert.equal(mapTransacao({ id: 'c', date: '2026-11-01', description: 'PAGTO FATURA CARTAO', amount: -900 }, conta, { nome: 'Itaú', hoje }), null);
  assert.equal(mapTransacao({ id: 'd', date: '2026-11-01', description: 'SALARIO EMPRESA', amount: 9000, operationType: 'TED' }, conta, { nome: 'Itaú', hoje }), null);
  assert.equal(mapTransacao({ id: 'e', date: '2026-11-01', description: 'APLICACAO CDB', amount: -1000 }, conta, { nome: 'Itaú', hoje }), null);
});

test('movimentações da conta viram Pix enviado/recebido ou débito', () => {
  assert.equal(mapTransacao({ id: 'p', date: '2026-11-01', description: 'PIX ENVIADO FULANO', amount: -80 }, conta, { nome: 'Itaú', hoje }).tipo, 'pix_enviado');
  assert.equal(mapTransacao({ id: 'q', date: '2026-11-01', description: 'TRANSF', amount: 80, operationType: 'PIX' }, conta, { nome: 'Itaú', hoje }).tipo, 'pix_recebido');
  const d = mapTransacao({ id: 'r', date: '2026-11-01', description: 'CONTA LUZ', amount: -120.4, operationType: 'BOLETO' }, conta, { nome: 'Itaú conta', hoje });
  assert.equal(d.tipo, 'debito');
  assert.equal(d.valor, 120.4);
  assert.equal(d.conta_ou_cartao, 'Itaú conta');
});

test('fatura da Pluggy vira lançamento de fatura', () => {
  const f = mapFatura({ id: 'f1', dueDate: '2026-12-15T00:00:00.000Z', totalAmount: 1536.87 }, 'Itaú');
  assert.equal(f.tipo, 'fatura');
  assert.equal(f.vencimento, '2026-12-15');
  assert.equal(f.conta_ou_cartao, 'Itaú');
  assert.equal(nomeConta(cartao, 'Nubank'), 'Nubank');
  assert.equal(nomeConta(cartao, 'Nubank', { variosCartoes: true }), 'Nubank final 1234');
  assert.equal(nomeConta(conta, 'Nubank'), 'Nubank conta');
});

test('banco do item do Meu Pluggy sai do nome das contas', () => {
  const mp = { connector: { name: 'MeuPluggy' } };
  assert.equal(bancoDoItem(mp, [{ type: 'BANK', name: 'Nu Pagamentos S.A. - Instituição de Pagamento' }, { type: 'CREDIT', name: 'platinum' }]), 'Nubank');
  assert.equal(bancoDoItem(mp, [{ type: 'BANK', name: 'itau' }, { type: 'CREDIT', name: 'PAO DE ACUCAR ITAU VISA PLATINUM' }]), 'Itaú');
  assert.equal(bancoDoItem(mp, [{ type: 'CREDIT', name: 'Mercado Pago' }]), 'Mercado Pago');
});

test('compra parcelada usa a data da compra e parcela futura fica de fora', () => {
  const tx = { id: 'z', description: 'LOJA02/18', amount: 416.78, status: 'POSTED', creditCardMetadata: { purchaseDate: '2026-10-06T19:31:06.000Z', installmentNumber: 2, totalInstallments: 18 } };
  const t = mapTransacao({ ...tx, date: '2026-11-05T03:00:00.000Z' }, cartao, { nome: 'Itaú', hoje });
  assert.equal(t.data, '2026-10-06');
  assert.equal(t.estabelecimento, 'LOJA (parcela 2/18)');
  assert.equal(mapTransacao({ ...tx, date: '2026-12-05T03:00:00.000Z' }, cartao, { nome: 'Itaú', hoje }), null);
});

test('não duplica o que já veio por e-mail/fatura', () => {
  const email = [
    { data: '2026-10-06', valor: 416.78, estabelecimento: 'Nathalia Leitao (parcela 2/18)', conta_ou_cartao: 'Itaú', tipo: 'compra', parcela_atual: 2, parcelas_total: 18, origem_email_id: 'gmail1' },
    { data: '2026-11-09', valor: 1536.87, estabelecimento: 'Fatura Itaú', conta_ou_cartao: 'Itaú', tipo: 'fatura', vencimento: '2026-11-09', origem_email_id: 'gmail2' },
    { data: '2026-10-10', valor: 50, estabelecimento: 'Padaria', conta_ou_cartao: 'Nubank', tipo: 'compra', origem_email_id: 'gmail3' },
  ];
  const pl = (o) => ({ origem_email_id: 'pluggy:x', ...o });
  const { novas, repetidas } = semDuplicatasCruzadas(
    [
      pl({ data: '2026-10-07', valor: 416.78, estabelecimento: 'NathaliaLeitaoDa (parcela 2/18)', conta_ou_cartao: 'Itaú', tipo: 'compra', parcela_atual: 2, parcelas_total: 18 }),
      pl({ data: '2026-10-06', valor: 416.78, estabelecimento: 'NathaliaLeitaoDa (parcela 3/18)', conta_ou_cartao: 'Itaú', tipo: 'compra', parcela_atual: 3, parcelas_total: 18 }),
      pl({ data: '2026-11-09', valor: 1536.87, estabelecimento: 'Fatura Itaú', conta_ou_cartao: 'Itaú', tipo: 'fatura', vencimento: '2026-11-09' }),
      pl({ data: '2026-10-10', valor: 50, estabelecimento: 'PADARIA', conta_ou_cartao: 'Itaú', tipo: 'compra' }),
      pl({ data: '2026-10-10', valor: 50, estabelecimento: 'PADARIA', conta_ou_cartao: 'Nubank', tipo: 'compra' }),
      pl({ data: '2026-10-10', valor: 50, estabelecimento: 'PADARIA', conta_ou_cartao: 'Nubank', tipo: 'compra' }),
    ],
    email,
  );
  assert.equal(repetidas.length, 3);
  assert.deepEqual(novas.map((t) => `${t.conta_ou_cartao} ${t.parcela_atual ?? ''}`), ['Itaú 3', 'Itaú ', 'Nubank ']);
});

test('sync grava sem duplicar, aplica regras, categoriza o resto e atualiza o saldo', async () => {
  const storage = createMemoryStorage();
  await storage.saveRegra?.('ifood', 'Alimentação');
  const recente = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
  const pluggy = {
    item: async () => ({ ...item, status: 'UPDATED', consentExpiresAt: '2027-11-01' }),
    contas: async () => [cartao, conta],
    faturas: async () => [],
    transacoes: async (id) =>
      id === 'c1'
        ? [
            { id: 'x1', date: recente, description: 'IFOOD', amount: 50 },
            { id: 'x2', date: recente, description: 'LOJA XYZ', amount: 70 },
          ]
        : [{ id: 'x3', date: recente, description: 'PIX ENVIADO', amount: -10 }],
  };
  const categorizar = async (nomes) => new Map(nomes.map((n) => [n, 'Compras']));
  const r = await syncPluggy({ storage, conjuntos: [{ pluggy, itemIds: ['i1'] }], categorizar, log: () => {} });
  assert.equal(r.novas, 3);
  const tx = await storage.listTransacoes();
  assert.equal(tx.find((t) => t.estabelecimento === 'IFOOD').categoria, 'Alimentação');
  assert.equal(tx.find((t) => t.estabelecimento === 'LOJA XYZ').categoria, 'Compras');
  assert.equal(JSON.parse(await storage.getConfig('saldo_atual')).valor, 1500.5);
  const de_novo = await syncPluggy({ storage, conjuntos: [{ pluggy, itemIds: ['i1'] }], categorizar, log: () => {} });
  assert.equal(de_novo.novas, 0);
});

test('estorno no cartão anula a compra; pagamento da fatura não', () => {
  const txs = [
    { id: '1', amount: 172.9, description: 'Amazon Credito' },
    { id: '2', amount: -172.9, description: 'Estorno de Amazon Credito - NuPay', category: 'Cashback' },
    { id: '3', amount: 152.28, description: 'Amazon Credito AMZ' },
    { id: '4', amount: -152.28, description: 'Pagamento recebido', category: 'Credit card payment' },
  ];
  assert.deepEqual(semEstornos(txs).map((t) => t.id), ['2', '3', '4']);
});

test('dois cartões Bradesco da casa ficam separados e batem com planilha/e-mail', () => {
  const infinite = { type: 'CREDIT', name: 'VISA INFINITE', owner: 'REBECCA B' };
  const nanquim = { type: 'CREDIT', name: 'ELO NANQUIM', owner: 'MARCUS V' };
  assert.equal(nomeConta(infinite, 'Bradesco'), 'Bradesco Visa Infinite');
  assert.equal(nomeConta(nanquim, 'Bradesco'), 'Bradesco Nanquim');
  assert.equal(cartaoDe('Infinit'), cartaoDe('Bradesco Visa Infinite'));
  assert.notEqual(cartaoDe('Bradesco Nanquim'), cartaoDe('Bradesco Visa Infinite'));
  assert.equal(cartaoDe('Itaú PDA'), cartaoDe('Itaú'));
  const tx = [
    { tipo: 'fatura', conta_ou_cartao: 'Infinit', valor: 5000, data: '2026-10-10', vencimento: '2026-10-10' },
    { tipo: 'fatura', conta_ou_cartao: 'Bradesco Nanquim', valor: 900, data: '2026-10-10', vencimento: '2026-10-10' },
    { tipo: 'compra', conta_ou_cartao: 'Bradesco Visa Infinite', valor: 100, data: '2026-09-20', vencimento: '2026-10-10' },
  ];
  assert.deepEqual(faturasSemDetalhe(tx).map((t) => t.conta_ou_cartao), ['Bradesco Nanquim']);
});

test('contas de outro titular levam o primeiro nome dele', () => {
  const contas = [
    { type: 'BANK', subtype: 'CHECKING_ACCOUNT', owner: 'MARCUS VINICIUS' },
    { type: 'BANK', subtype: 'CHECKING_ACCOUNT', owner: 'Marcus Vinícius' },
    { type: 'BANK', subtype: 'CHECKING_ACCOUNT', owner: 'REBECCA BARRETO' },
  ];
  assert.equal(titularPrincipal(contas), 'Marcus');
  assert.equal(nomeConta(contas[2], 'Bradesco', { outroTitular: true }), 'Bradesco conta Rebecca');
  assert.equal(nomeConta(contas[0], 'Bradesco'), 'Bradesco conta');
});

test('paginação da Pluggy anexa o `next` (query string) ao caminho', async () => {
  const { createPluggy } = await import('../src/pluggy/client.js');
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(url);
    if (url.endsWith('/auth')) return { ok: true, json: async () => ({ apiKey: 'k' }) };
    const pag2 = url.includes('after=abc');
    return { ok: true, json: async () => ({ results: [{ id: pag2 ? 2 : 1 }], next: pag2 ? null : '?accountId=a&after=abc%3D%3D' }) };
  };
  const p = createPluggy({ clientId: 'i', clientSecret: 's' }, fetchFn);
  assert.deepEqual((await p.transacoes('a', { from: '2026-01-01' })).map((t) => t.id), [1, 2]);
  assert.equal(urls.at(-1), 'https://api.pluggy.ai/v2/transactions?accountId=a&after=abc%3D%3D');
});

test('contas correntes: tira transferência da casa, pagamento de fatura e fixo já planejado', async () => {
  const { semMovimentosDuplicados } = await import('../src/pluggy/movimentos.js');
  const t = (conta_ou_cartao, tipo, valor, data, estabelecimento = 'x') => ({ conta_ou_cartao, tipo, valor, data, estabelecimento });
  const linhas = [
    t('Caixa conta', 'pix_enviado', 1200, '2026-10-09'),
    { ...t('Bradesco conta Rebecca', 'pix_recebido', 1200, '2026-10-09'), entre_titulares: true },
    { ...t('Bradesco conta Rebecca', 'pix_enviado', 246.36, '2026-10-01'), entre_titulares: true },
    t('Caixa conta', 'pix_enviado', 459.49, '2026-10-22'),
    t('Caixa conta', 'pix_enviado', 2800, '2026-10-02'),
    t('Caixa conta', 'debito', 2921.29, '2026-10-19'),
    t('Caixa conta', 'pix_enviado', 149.9, '2026-10-19', 'loja'),
  ];
  const faturas = [{ tipo: 'fatura', conta_ou_cartao: 'Mercado Pago', valor: 459.49, vencimento: '2026-10-25' }];
  const planejamento = [{ id: 1, descricao: 'Apê', direcao: 'saida', valor: 2900, recorrente: true, inicio: '2026-01-01' }];
  const r = semMovimentosDuplicados(linhas, { faturas, planejamento });
  assert.deepEqual(r.linhas.map((l) => l.valor), [2800, 149.9]);
  assert.deepEqual(r.removidos.map((l) => l.motivo), [
    'transferência entre contas da casa',
    'transferência entre contas da casa',
    'pagamento da fatura Mercado Pago',
    'Pix entre contas do casal',
    'gasto fixo já planejado: Apê',
  ]);
});

test('Pix entre o casal não entra e previsão de fatura segue o padrão do banco', async () => {
  const { nomesDosTitulares, deslocamentoPrevisao } = await import('../src/pluggy/map.js');
  const contas = [{ owner: 'MARCUS VINICIUS FERNANDES' }, { owner: 'REBECCA BARRETO DE MATOS' }];
  const titulares = nomesDosTitulares(contas);
  assert.deepEqual(titulares, ['marcus vinicius', 'rebecca barreto']);
  const banco = { type: 'BANK' };
  const pix = (description, amount) => ({ id: description, date: '2026-10-01', amount, description, operationType: 'PIX' });
  assert.equal(mapTransacao(pix('PIX ENVIADO - DES  MARCUS VINICIUS FERNA 01/10', -246.36), banco, { nome: 'b', titulares, hoje: '2026-11-01' }).entre_titulares, true);
  const amazon = mapTransacao(pix('PIX QR CODE DINAMICO - DES  AMAZON', -76.94), banco, { nome: 'b', titulares, hoje: '2026-11-01' });
  assert.equal(amazon.tipo, 'pix_enviado');
  assert.equal(amazon.entre_titulares, undefined);
  assert.equal(mapTransacao(pix('GASTOS CARTAO DE CREDITO', -694.9), banco, { nome: 'b', hoje: '2026-11-01' }), null);

  const faturasPorId = new Map([['b1', { id: 'b1', dueDate: '2026-11-10' }]]);
  const cartao = { type: 'CREDIT', creditData: { balanceDueDate: '2026-11-10' } };
  const faturada = { id: 1, date: '2026-10-01', amount: 10, description: 'A', creditCardMetadata: { billId: 'b1', billForecastDate: '2026-10-01' } };
  const aberta = { id: 2, date: '2026-11-01', amount: 20, description: 'B', creditCardMetadata: { billForecastDate: '2026-11-01' } };
  const desloc = deslocamentoPrevisao([faturada, aberta], faturasPorId);
  assert.equal(desloc, 1);
  assert.equal(mapTransacao(aberta, cartao, { nome: 'c', faturasPorId, deslocamento: desloc, hoje: '2026-11-05' }).vencimento, '2026-12-10');
});

test('devolução de Pix anula a ida e fatura incompleta mantém o total', async () => {
  const { semDevolucoes, faturasIncompletas } = await import('../src/pluggy/map.js');
  const txs = [
    { id: 1, date: '2026-10-07', amount: -86.96, description: 'DEB PIX QR COD DIN' },
    { id: 2, date: '2026-10-07', amount: 86.96, description: 'DEVOLUCAO PIX RECEBIDO' },
    { id: 3, date: '2026-10-07', amount: -10, description: 'DEB PIX' },
  ];
  assert.deepEqual(semDevolucoes(txs).map((t) => t.id), [3]);
  const linhas = [{ fatura_id: 'a', valor: 4101.51 }, { fatura_id: 'b', valor: 459.77 }];
  const faturas = [{ id: 'a', totalAmount: 4966.99 }, { id: 'b', totalAmount: 459.49 }];
  assert.deepEqual([...faturasIncompletas(linhas, faturas)], ['a']);
});

test('compra da fatura em PDF sem "X/Y" casa com a do Open Finance e ganha as parcelas', async () => {
  const storage = createMemoryStorage();
  await storage.saveTransacoes([
    { data: '2026-04-01', valor: 225.95, estabelecimento: 'AZUL SEGUROS', conta_ou_cartao: 'Bradesco Infinite', categoria: 'Outros', tipo: 'compra', vencimento: '2026-11-10', dedupe_key: 'pdf1', origem_email_id: 'gmail:1' },
  ]);
  const pluggy = {
    item: async () => ({ status: 'UPDATED', connector: { name: 'MeuPluggy' } }),
    contas: async () => [{ id: 'c', type: 'CREDIT', name: 'VISA INFINITE', marketingName: 'Bradesco Visa Infinite', owner: 'REBECCA B' }],
    faturas: async () => [{ id: 'b', dueDate: '2026-11-10', totalAmount: 225.95 }],
    transacoes: async () => [
      { id: 't', date: '2026-11-01', amount: 225.95, description: 'AZUL SEGUROS 07/10', creditCardMetadata: { billId: 'b', purchaseDate: '2026-04-02', installmentNumber: 7, totalInstallments: 10 } },
    ],
  };
  const r = await syncPluggy({ storage, conjuntos: [{ pluggy, itemIds: ['i'] }], dias: 30, categorizar: async () => new Map(), log: () => {} });
  assert.deepEqual(r.transacoes.map((x) => x.tipo), ['fatura']);
  const [t] = (await storage.listTransacoes()).filter((x) => x.tipo === 'compra');
  assert.equal(t.parcelas_total, 10);
  assert.equal(t.parcela_atual, 7);
});
