import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoDoItem, mapFatura, mapTransacao, nomeConta, semEstornos } from '../src/pluggy/map.js';
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
