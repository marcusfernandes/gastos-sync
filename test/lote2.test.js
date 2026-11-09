import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caixaRevisao } from '../src/summary/analises.js';
import { aporteMensal, resumoMetas, validarMetas } from '../src/summary/metas.js';
import { projecao } from '../src/summary/forecast.js';
import { fechamento, textoFechamento } from '../src/summary/fechamento.js';
import { gastosPorPessoa } from '../src/summary/pessoas.js';
import { createMemoryStorage } from '../src/storage/memory.js';
import { marcarRevisados, lerRevisados } from '../src/summary/revisao.js';

const c = (data, estabelecimento, valor, extra = {}) => ({ id: `${data}-${estabelecimento}-${valor}`, tipo: 'compra', conta_ou_cartao: 'Nubank', categoria: 'Lazer', data, estabelecimento, valor, ...extra });
const salario = (responsavel, valor) => ({ id: responsavel, direcao: 'entrada', recorrente: true, responsavel, descricao: 'Salário', valor, inicio: '2026-01-01', categoria: 'Salário' });

test('caixa de revisão: Outros, repetidas e valores altos; revisados saem da fila', async () => {
  const tx = [
    c('2026-11-02', 'Loja X', 50, { categoria: 'Outros' }),
    c('2026-11-03', 'Mercado Bom', 80, { categoria: 'Mercado' }),
    c('2026-11-04', 'Mercado Bom', 80, { categoria: 'Mercado' }),
    c('2026-11-05', 'Geladeira', 3200, { categoria: 'Casa' }),
    c('2026-11-06', 'Sofá (parcela 1/10)', 1500, { categoria: 'Casa', parcela_atual: 1, parcelas_total: 10 }),
  ];
  const itens = caixaRevisao(tx, '2026-11');
  assert.deepEqual(itens.map((i) => i.tipo), ['repetida', 'alto', 'outros']);
  const storage = createMemoryStorage();
  await marcarRevisados(storage, [itens[2].transacao.id]);
  assert.equal(caixaRevisao(tx, '2026-11', await lerRevisados(storage)).length, 2);
});

test('metas: aporte mensal até o prazo e desconto na projeção', () => {
  const [m] = validarMetas([{ nome: 'Mudança', alvo: '12000', guardado: 2000, prazo: '2027-04' }]);
  assert.equal(aporteMensal(m, '2026-11'), 2000);
  assert.equal(resumoMetas([m], '2026-11').aporte_total, 2000);
  const plan = [salario('Marcão', 5000)];
  const sem = projecao([], plan, { mesAtual: '2026-11', meses: 7 });
  const com = projecao([], plan, { mesAtual: '2026-11', meses: 7, metas: [m] });
  assert.equal(com.meses[0].reservas, 2000);
  assert.equal(com.meses[5].reservas, 0);
  assert.equal(sem.meses[6].saldo_projetado - com.meses[6].saldo_projetado, 10000);
  assert.throws(() => validarMetas([{ nome: 'X', alvo: 0, prazo: '2027-01' }]));
});

test('fechamento: compara com o mês anterior e mostra a projeção', () => {
  const tx = [c('2026-10-05', 'Show', 300), c('2026-11-05', 'Show', 100), c('2026-11-06', 'Farmácia', 200, { categoria: 'Saúde' })];
  const f = fechamento({ transacoes: tx, planejamento: [salario('Marcão', 1000)], mes: '2026-11', saldoAtual: 0 });
  assert.equal(f.saidas, 300);
  assert.equal(f.resultado, 700);
  assert.equal(f.anterior.resultado, 700);
  assert.deepEqual(f.altas.map((x) => x.categoria), ['Saúde']);
  assert.deepEqual(f.quedas.map((x) => x.categoria), ['Lazer']);
  const texto = textoFechamento(f, { brl: (n) => `R$${n}`, mesBR: (m) => m });
  assert.match(texto, /Fechamento de 2026-11/);
});

test('gastos por pessoa: sem responsável é do casal, divisão pela renda', () => {
  const tx = [
    c('2026-11-02', 'Bar', 100, { responsavel: 'Marcão' }),
    c('2026-11-03', 'Salão', 200, { responsavel: 'Becca' }),
    c('2026-11-04', 'Mercado', 300),
  ];
  const r = gastosPorPessoa(tx, [salario('Marcão', 6000), salario('Becca', 3000)], '2026-11');
  assert.deepEqual(r.grupos.map((g) => [g.pessoa, g.total]), [['Becca', 200], ['Marcão', 100], ['Casal', 300]]);
  const marcao = r.divisao.find((d) => d.pessoa === 'Marcão');
  assert.equal(marcao.total_proporcional, 300);
  assert.equal(marcao.total_meio_a_meio, 250);
});
