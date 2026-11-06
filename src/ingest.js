import { pathToFileURL } from 'node:url';
import { createGmail, fetchBankEmails, markAsProcessed } from './gmail/client.js';
import { parseEmail } from './parser/gemini.js';
import { createStorage } from './storage/index.js';

const fmt = (t) =>
  `${t.data}  R$ ${t.valor.toFixed(2).padStart(10)}  ${t.tipo.padEnd(12)} ${t.estabelecimento} [${t.conta_ou_cartao} / ${t.categoria}]`;

export async function runIngestion({ fetchEmails, parse, storage, markProcessed, dryRun = false, log = console.log }) {
  const emails = await fetchEmails();
  log(`${emails.length} e-mail(s) novo(s) encontrado(s).`);

  const transacoes = [];
  const processados = [];
  const falhas = [];
  for (const email of emails) {
    try {
      const extraidas = await parse(email);
      log(`- "${email.subject}" -> ${extraidas.length} transação(ões)`);
      transacoes.push(...extraidas);
      processados.push(email.id);
    } catch (err) {
      falhas.push({ id: email.id, subject: email.subject, erro: err.message });
      log(`! Falha ao processar "${email.subject}": ${err.message}`);
    }
  }

  if (dryRun) {
    transacoes.forEach((t) => log(`  ${fmt(t)}`));
    log('Dry-run: nada foi salvo nem marcado no Gmail.');
    return { emails: emails.length, transacoes, inserted: [], skipped: 0, falhas };
  }

  const { inserted, skipped } = await storage.saveTransacoes(transacoes);
  // Só marca no Gmail depois de salvar; e-mails com falha ficam para a próxima execução.
  await markProcessed(processados);

  inserted.forEach((t) => log(`+ ${fmt(t)}`));
  log(`Inseridas: ${inserted.length} | Duplicadas ignoradas: ${skipped} | Falhas: ${falhas.length}`);
  return { emails: emails.length, transacoes, inserted, skipped, falhas };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const gmail = createGmail();
  const result = await runIngestion({
    fetchEmails: () => fetchBankEmails(gmail),
    parse: (email) => parseEmail(email),
    storage: dryRun ? null : await createStorage(),
    markProcessed: (ids) => markAsProcessed(gmail, ids),
    dryRun,
  });
  if (result.falhas.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
