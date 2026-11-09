import { pathToFileURL } from 'node:url';
import {
  createGmail,
  fetchBankEmails,
  markAsProcessed,
  resolveForwardingAddress,
  resolveRefreshToken,
} from './gmail/client.js';
import { parseEmail } from './parser/gemini.js';
import { contextoParser, createStorage } from './storage/index.js';
import { semDuplicatasCruzadas } from './dedupe.js';

const CONCORRENCIA = 4;
const VALOR_EM_REAIS = /R\$\s?\d|\d{1,3}(\.\d{3})*,\d{2}\b/;

export function pareceTransacao(email) {
  return Boolean(email.anexos?.length) || VALOR_EM_REAIS.test(`${email.subject}\n${email.body}`);
}

function resumirErro(err) {
  const msg = err?.message || String(err);
  try {
    return JSON.parse(msg).error?.message?.split('\n')[0] || msg;
  } catch {
    return msg.slice(0, 300);
  }
}

const cotaEsgotada = (err) => (err?.status ?? err?.code) === 429 && /quota|RESOURCE_EXHAUSTED/i.test(err?.message || '');

const fmt = (t) =>
  `${t.data}  R$ ${t.valor.toFixed(2).padStart(10)}  ${t.tipo.padEnd(12)} ${t.estabelecimento} [${t.conta_ou_cartao} / ${t.categoria}]`;

export async function runIngestion({ fetchEmails, parse, storage, markProcessed, dryRun = false, log = console.log }) {
  const emails = await fetchEmails();
  log(`${emails.length} e-mail(s) novo(s) encontrado(s).`);

  const transacoes = [];
  const processados = [];
  const falhas = [];
  const candidatos = [];
  for (const email of emails) {
    if (pareceTransacao(email)) candidatos.push(email);
    else {
      log(`- "${email.subject}" -> ignorado (sem valores em R$)`);
      processados.push(email.id);
    }
  }

  let interrompido = false;
  let tentados = 0;
  for (let i = 0; i < candidatos.length && !interrompido; i += CONCORRENCIA) {
    const lote = candidatos.slice(i, i + CONCORRENCIA);
    const resultados = await Promise.allSettled(lote.map((email) => parse(email)));
    tentados += lote.length;
    resultados.forEach((r, j) => {
      const email = lote[j];
      if (r.status === 'fulfilled') {
        log(`- "${email.subject}" -> ${r.value.length} transação(ões)`);
        transacoes.push(...r.value);
        processados.push(email.id);
      } else {
        if (cotaEsgotada(r.reason)) interrompido = true;
        falhas.push({ id: email.id, subject: email.subject, erro: resumirErro(r.reason) });
        log(`! Falha ao processar "${email.subject}": ${resumirErro(r.reason)}`);
      }
    });
  }
  if (interrompido) {
    log(`Cota do Gemini esgotada: ${candidatos.length - tentados} e-mail(s) não enviados, mais os que falharam, ficaram para a próxima execução. Ative o billing em https://aistudio.google.com/apikey.`);
  }

  if (transacoes.length && storage?.listTransacoes) {
    const desde = transacoes.map((t) => t.data).sort()[0];
    const gravadas = await Promise.resolve()
      .then(() => storage.listTransacoes({ desde: new Date(Date.parse(desde) - 5 * 864e5).toISOString().slice(0, 10) }))
      .catch((e) => (log(`! não consegui comparar com o Open Finance: ${e.message}`), []));
    const doOpenFinance = gravadas.filter((t) => String(t.origem_email_id || '').startsWith('pluggy:'));
    const r = semDuplicatasCruzadas(transacoes, doOpenFinance);
    if (r.repetidas.length) log(`${r.repetidas.length} transação(ões) já vieram pelo Open Finance e foram ignoradas.`);
    transacoes.splice(0, transacoes.length, ...r.novas);
  }

  if (dryRun) {
    transacoes.forEach((t) => log(`  ${fmt(t)}`));
    log('Simulação: nada foi salvo nem marcado no Gmail.');
    return { emails: emails.length, transacoes, inserted: [], skipped: 0, falhas };
  }

  const { inserted, skipped } = await storage.saveTransacoes(transacoes);
  // Só marca no Gmail depois de salvar; e-mails com falha ficam para a próxima execução.
  await markProcessed(processados);

  inserted.forEach((t) => log(`+ ${fmt(t)}`));
  log(`Inseridas: ${inserted.length} | Duplicadas ignoradas: ${skipped} | Falhas: ${falhas.length}`);
  return { emails: emails.length, transacoes, inserted, skipped, falhas };
}

export async function ingestNow({ dryRun = false, storage, log = console.log } = {}) {
  const store = storage ?? (await createStorage());
  const gmail = createGmail(await resolveRefreshToken(store));
  const forwardTo = await resolveForwardingAddress(gmail);
  if (forwardTo) log(`Também lendo e-mails encaminhados para ${forwardTo}`);
  const contexto = await contextoParser(store);
  return runIngestion({
    fetchEmails: () => fetchBankEmails(gmail, forwardTo),
    parse: (email) => parseEmail(email, undefined, contexto),
    storage: store,
    markProcessed: (ids) => markAsProcessed(gmail, ids),
    dryRun,
    log,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestNow({ dryRun: process.argv.includes('--dry-run') })
    .then((result) => {
      if (result.falhas.length) process.exitCode = 1;
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
