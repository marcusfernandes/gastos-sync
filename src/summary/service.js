import { config } from '../config.js';
import { createStorage } from '../storage/index.js';
import { addMeses, projecao, resumoMensal } from './forecast.js';
import { lerMetas, resumoMetas } from './metas.js';

export const mesCorrente = () => new Date().toISOString().slice(0, 7);

export async function carregarDados(storage, mesBase) {
  const desde = `${addMeses(mesBase, -config.summary.mesesHistoricoVariavel)}-01`;
  const [transacoes, planejamento] = await Promise.all([
    storage.listTransacoes({ desde }),
    storage.listPlanejamento(),
  ]);
  return { transacoes, planejamento };
}

export async function gerarRelatorio({ mes = mesCorrente(), meses = 6, saldoInicial, storage } = {}) {
  const store = storage ?? (await createStorage());
  const { transacoes, planejamento } = await carregarDados(store, mes);
  const metas = await lerMetas(store);
  return {
    resumo: resumoMensal(transacoes, planejamento, mes),
    metas: resumoMetas(metas, mes),
    projecao: projecao(transacoes, planejamento, {
      mesAtual: mes,
      meses,
      saldoInicial: saldoInicial ?? config.summary.saldoInicial,
      mesesHistorico: config.summary.mesesHistoricoVariavel,
      metas,
    }),
  };
}
