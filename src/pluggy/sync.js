import { config } from '../config.js';
import { chaveEstabelecimento } from '../parser/normalize.js';
import { categorizarEstabelecimentos } from '../parser/gemini.js';
import { contextoParser } from '../storage/index.js';
import { createPluggy } from './client.js';
import { bancoDoItem, mapFatura, mapTransacao, nomeConta, semEstornos } from './map.js';
import { semDuplicatasCruzadas } from '../dedupe.js';

const LOTE_IA = 150;
const addDias = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

export async function syncPluggy({
  storage,
  conjuntos = config.pluggy.conjuntos.map((c) => ({
    pluggy: createPluggy(c),
    itemIds: c.itemIds,
  })),
  dias = config.pluggy.diasSync,
  categorizar = categorizarEstabelecimentos,
  dryRun = false,
  log = console.log,
}) {
  const hoje = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10);
  const linhas = [];
  const itens = [];
  let saldo = null;

  for (const { pluggy, itemIds } of conjuntos)
    for (const itemId of itemIds) {
      const item = await pluggy.item(itemId);
      const contas = await pluggy.contas(itemId);
      const banco = bancoDoItem(item, contas);
      const variosCartoes = contas.filter((c) => c.type === 'CREDIT').length > 1;
      const info = {
        id: itemId,
        banco,
        status: item.status,
        erro: item.error?.code || null,
        atualizado_em: item.lastUpdatedAt || item.updatedAt || null,
        consentimento_expira: item.consentExpiresAt || null,
        contas: [],
      };
      for (const conta of contas) {
        const nome = nomeConta(conta, banco, { variosCartoes });
        const faturas = conta.type === 'CREDIT' ? await pluggy.faturas(conta.id).catch(() => []) : [];
        const faturasPorId = new Map(faturas.map((f) => [f.id, f]));
        // Compras de cartão contam pela fatura: busca antes de `from` para ter as faturas completas.
        const txs = await pluggy.transacoes(conta.id, { from: addDias(from, -45) });
        const antes = linhas.length;
        for (const tx of conta.type === 'CREDIT' ? semEstornos(txs) : txs) {
          const t = mapTransacao(tx, conta, { nome, faturasPorId, hoje });
          if (t && (t.vencimento || t.data) >= from) linhas.push(t);
        }
        for (const f of faturas) if (String(f.dueDate).slice(0, 10) >= from) linhas.push(mapFatura(f, nome));
        if (conta.type === 'BANK') saldo = Math.round(((saldo ?? 0) + Number(conta.balance || 0)) * 100) / 100;
        info.contas.push({
          nome,
          tipo: conta.type,
          saldo: conta.balance,
          lidas: txs.length,
          novas: linhas.length - antes,
        });
        log(`- ${nome}: ${txs.length} movimentação(ões), ${linhas.length - antes} aproveitada(s)`);
      }
      itens.push(info);
    }

  const validas = linhas.filter(Boolean);
  const gravadas = await storage.listTransacoes({ desde: addDias(from, -90) });
  const existentes = new Set(gravadas.map((t) => t.dedupe_key));
  const cruzado = semDuplicatasCruzadas(
    validas.filter((t) => !existentes.has(t.dedupe_key)),
    gravadas,
  );
  const novas = cruzado.novas;
  if (cruzado.repetidas.length) log(`${cruzado.repetidas.length} já registrada(s) por e-mail/fatura, ignorada(s)`);

  const { categorias, regras } = await contextoParser(storage);
  const semRegra = [];
  for (const t of novas) {
    if (t.tipo === 'fatura') continue;
    const regra = regras.get(chaveEstabelecimento(t.estabelecimento));
    if (regra) t.categoria = regra;
    else semRegra.push(t);
  }
  const base = (t) => t.estabelecimento.replace(/\s*\(parcela.*\)$/i, '');
  const nomes = [...new Set(semRegra.map(base))];
  for (let i = 0; i < nomes.length; i += LOTE_IA) {
    const mapa = await categorizar(nomes.slice(i, i + LOTE_IA), categorias).catch((e) => {
      log(`! categorização falhou: ${e.message}`);
      return new Map();
    });
    for (const t of semRegra) t.categoria = mapa.get(base(t)) || t.categoria;
  }

  const resultado = {
    itens,
    saldo,
    novas: novas.length,
    ignoradas: validas.length - novas.length,
    repetidas: cruzado.repetidas,
    transacoes: novas,
  };
  if (dryRun) return resultado;
  const { inserted } = await storage.saveTransacoes(novas);
  resultado.novas = inserted.length;
  const agora = new Date().toISOString();
  const anterior = JSON.parse((await storage.getConfig?.('saldo_atual')) || 'null');
  // Saldo digitado no painel vale mais: as contas conectadas podem não ser todas.
  if (saldo != null && storage.setConfig && (!anterior || anterior.fonte === 'Open Finance')) {
    await storage.setConfig(
      'saldo_atual',
      JSON.stringify({
        valor: saldo,
        atualizado_em: agora,
        fonte: 'Open Finance',
        contas: itens.map((i) => i.banco).join(', '),
      }),
    );
  }
  await storage.setConfig?.('pluggy_status', JSON.stringify({ em: agora, novas: inserted.length, itens }));
  return resultado;
}
