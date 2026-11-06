// Testa o parser do Gemini com um e-mail salvo em arquivo (.txt/.html/.eml), sem Gmail nem banco.
// Uso: npm run parse:file -- caminho/do/email.txt
import { readFile } from 'node:fs/promises';
import { htmlToText } from '../src/gmail/client.js';
import { parseEmail } from '../src/parser/gemini.js';

const file = process.argv[2];
if (!file) {
  console.error('Uso: npm run parse:file -- caminho/do/email.txt');
  process.exit(1);
}
const raw = await readFile(file, 'utf8');
const body = /<html|<body|<table/i.test(raw) ? htmlToText(raw) : raw;
const subject = raw.match(/^Subject:\s*(.+)$/im)?.[1] ?? file;
const from = raw.match(/^From:\s*(.+)$/im)?.[1] ?? '';
const transacoes = await parseEmail({ id: `file:${file}`, from, subject, date: new Date().toISOString(), body });
console.log(JSON.stringify(transacoes, null, 2));
