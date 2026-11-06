import { pathToFileURL } from 'node:url';
import {
  createGmail,
  fetchBankEmails,
  markAsProcessed,
  resolveForwardingAddress,
  resolveRefreshToken,
} from './gmail/client.js';
import { parseEmail } from './parser/gemini.js';
import { createStorage } from './storage/index.js';

const CONCORRENCIA = 4;

const fmt = (t) =>
  `${t.data}  R$ ${t.valor.toFixed(2).padStart(10)}  ${t.tipo.padEnd(12)} ${t.estabelecimento} [${t.conta_ou_cartao} / ${t.categoria}]`;

export async function runIngestion({ fetchEmails, parse, storage, markProcessed, dryRun = false, log = console.log }) {
  const emails = await fetchEmails();
  log(`${emails.length} e-mail(s) novo(s) encontrado(s).`);

  const transacoes = [];
  const processados = [];
  const falhas = [];
  for (let i = 0; i < emails.length; i += CONCORRENCIA) {
    const lote = emails.slice(i, i + CONCORRENCIA);
    const resultados = await Promise.allSettled(lote.map((email) => parse(email)));
    resultados.forEach((r, j) => {
      const email = lote[j];
      if (r.status === 'fulfilled') {
        log(`- "${email.subject}" -> ${r.value.length} transação(ões)`);
        transacoes.push(...r.value);
        processados.push(email.id);
      } else {
        falhas.push({ id: email.id, subject: email.subject, erro: r.reason?.message });
        log(`! Falha ao processar "${email.subject}": ${r.reason?.message}`);
      }
    });
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
  return runIngestion({
    fetchEmails: () => fetchBankEmails(gmail, forwardTo),
    parse: (email) => parseEmail(email),
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
