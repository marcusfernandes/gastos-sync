import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapFatura, mapTransacao, nomeConta } from '../src/pluggy/map.js';
import { syncPluggy } from '../src/pluggy/sync.js';
import { createMemoryStorage } from '../src/storage/memory.js';

const item = { connector: { name: 'Itaú' } };
const cartao = { id: 'c1', type: 'CREDIT', subtype: 'CREDIT_CARD', name: 'Personnalité Visa Infinite', number: '1234', creditData: { balanceDueDate: '2026-11-15' } };
const conta = { id: 'b1', type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'Conta corrente', balance: 1500.5 };
const hoje = '2026-11-08';

test('compra parcelada no cartão vira compra com parcela e vencimento da fatura', () => {
  const faturasPorId = new Map([['f1', { id: 'f1', dueDate: '2026-12-15T00:00:00.000Z' }]]);
  const t = mapTransacao(
    { id: 't1', date: '2026-11-02T00:00:00.000Z', description: 'MAGALU', amount: 199.9, status: 'POSTED', creditCardMetadata: { installmentNumber: 4, totalInstallments: 10, billId: 'f1' } },
    cartao,
    { item, faturasPorId, hoje },
  );
  assert.equal(t.tipo, 'compra');
  assert.equal(t.estabelecimento, 'MAGALU (parcela 4/10)');
  assert.equal(t.parcela_atual, 4);
  assert.equal(t.vencimento, '2026-12-15');
  assert.equal(t.conta_ou_cartao, 'Itaú Personnalité Visa Infinite final 1234');
  assert.equal(t.origem_email_id, 'pluggy:t1');
});

test('sem fatura conhecida usa billForecastDate com o dia de vencimento do cartão', () => {
  const t = mapTransacao({ id: 't2', date: '2026-11-03', description: 'IFOOD', amount: 50, status: 'PENDING', creditCardMetadata: { billForecastDate: '2026-12' } }, cartao, { item, hoje });
  assert.equal(t.vencimento, '2026-12-15');
});

test('pagamento de fatura, estorno, parcela futura e créditos que não são Pix ficam de fora', () => {
  assert.equal(mapTransacao({ id: 'a', date: '2026-11-01', description: 'PAGAMENTO', amount: -900 }, cartao, { item, hoje }), null);
  assert.equal(mapTransacao({ id: 'b', date: '2027-01-02', description: 'LOJA', amount: 100, status: 'PENDING' }, cartao, { item, hoje }), null);
  assert.equal(mapTransacao({ id: 'c', date: '2026-11-01', description: 'PAGTO FATURA CARTAO', amount: -900 }, conta, { item, hoje }), null);
  assert.equal(mapTransacao({ id: 'd', date: '2026-11-01', description: 'SALARIO EMPRESA', amount: 9000, operationType: 'TED' }, conta, { item, hoje }), null);
  assert.equal(mapTransacao({ id: 'e', date: '2026-11-01', description: 'APLICACAO CDB', amount: -1000 }, conta, { item, hoje }), null);
});

test('movimentações da conta viram Pix enviado/recebido ou débito', () => {
  assert.equal(mapTransacao({ id: 'p', date: '2026-11-01', description: 'PIX ENVIADO FULANO', amount: -80 }, conta, { item, hoje }).tipo, 'pix_enviado');
  assert.equal(mapTransacao({ id: 'q', date: '2026-11-01', description: 'TRANSF', amount: 80, operationType: 'PIX' }, conta, { item, hoje }).tipo, 'pix_recebido');
  const d = mapTransacao({ id: 'r', date: '2026-11-01', description: 'CONTA LUZ', amount: -120.4, operationType: 'BOLETO' }, conta, { item, hoje });
  assert.equal(d.tipo, 'debito');
  assert.equal(d.valor, 120.4);
  assert.equal(d.conta_ou_cartao, 'Itaú conta');
});

test('fatura da Pluggy vira lançamento de fatura', () => {
  const f = mapFatura({ id: 'f1', dueDate: '2026-12-15T00:00:00.000Z', totalAmount: 1536.87 }, cartao, item);
  assert.equal(f.tipo, 'fatura');
  assert.equal(f.vencimento, '2026-12-15');
  assert.equal(nomeConta(cartao, { connector: { name: 'Nubank' } }), 'Nubank Personnalité Visa Infinite final 1234');
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
