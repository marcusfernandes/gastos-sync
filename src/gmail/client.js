import { google } from 'googleapis';
import { config } from '../config.js';

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];

export function createOAuthClient() {
  const { clientId, clientSecret, redirectUri } = config.gmail;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function createGmail(refreshToken = process.env.GOOGLE_REFRESH_TOKEN) {
  if (!refreshToken) throw new Error('Gmail não conectado: defina GOOGLE_REFRESH_TOKEN ou use "Conectar Gmail" no painel.');
  const auth = createOAuthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth });
}

export async function resolveRefreshToken(storage) {
  if (process.env.GOOGLE_REFRESH_TOKEN) return process.env.GOOGLE_REFRESH_TOKEN;
  return storage?.getConfig ? storage.getConfig('google_refresh_token') : null;
}

function decodeBase64Url(data) {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

export function htmlToText(html) {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export function extractBody(payload) {
  const plain = [];
  const html = [];
  const walk = (part) => {
    if (!part) return;
    if (part.body?.data) {
      if (part.mimeType === 'text/plain') plain.push(decodeBase64Url(part.body.data));
      else if (part.mimeType === 'text/html') html.push(decodeBase64Url(part.body.data));
    }
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  const text = plain.join('\n').trim();
  return text || htmlToText(html.join('\n'));
}

const MAX_ANEXOS = 3;
const MAX_ANEXO_BYTES = 15 * 1024 * 1024;

export function findPdfAttachments(payload) {
  const found = [];
  const walk = (part) => {
    if (!part) return;
    const isPdf = part.mimeType === 'application/pdf' || /\.pdf$/i.test(part.filename || '');
    if (isPdf && (part.body?.attachmentId || part.body?.data) && (part.body?.size ?? 0) <= MAX_ANEXO_BYTES) {
      found.push({ filename: part.filename || 'anexo.pdf', attachmentId: part.body.attachmentId, data: part.body.data });
    }
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  return found.slice(0, MAX_ANEXOS);
}

const toBase64 = (b64url) => b64url.replace(/-/g, '+').replace(/_/g, '/');

async function downloadPdfs(gmail, messageId, payload) {
  const anexos = [];
  for (const a of findPdfAttachments(payload)) {
    let data = a.data;
    if (!data) {
      const res = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: a.attachmentId });
      data = res.data.data;
    }
    anexos.push({ filename: a.filename, mimeType: 'application/pdf', data: toBase64(data) });
  }
  return anexos;
}

export function forwardingAddress(email, setting) {
  if (!setting || setting === 'off') return null;
  if (setting !== 'auto') return setting;
  if (!email) return null;
  const [user, domain] = email.split('@');
  return `${user.split('+')[0]}+gastos@${domain}`;
}

function header(headers, name) {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

async function getOrCreateLabelId(gmail, name) {
  const { data } = await gmail.users.labels.list({ userId: 'me' });
  const existing = data.labels?.find((l) => l.name === name);
  if (existing) return existing.id;
  const created = await gmail.users.labels.create({
    userId: 'me',
    requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
  });
  return created.data.id;
}

export const AUTOENVIO = 'from:me to:me filename:pdf (fatura OR extrato OR comprovante OR boleto)';

export function buildQuery({ query, lookbackDays, processedLabel, forwardTo }) {
  const label = processedLabel.replace(/[\s/]+/g, '-');
  // Também aceita PDFs de fatura/extrato que você envia para si mesmo pelo app do banco.
  const origem = forwardTo ? `{(${query}) to:${forwardTo} (${AUTOENVIO})}` : query;
  return `${origem} newer_than:${lookbackDays}d -label:${label}`;
}

export async function resolveForwardingAddress(gmail) {
  const setting = config.gmail.encaminhamento;
  if (setting !== 'auto') return forwardingAddress(null, setting);
  const { data } = await gmail.users.getProfile({ userId: 'me' });
  return forwardingAddress(data.emailAddress, setting);
}

export async function fetchBankEmails(gmail, forwardTo) {
  const cfg = config.gmail;
  const q = buildQuery({ ...cfg, forwardTo: forwardTo === undefined ? await resolveForwardingAddress(gmail) : forwardTo });
  const messages = [];
  let pageToken;
  do {
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults: Math.min(cfg.maxMessages - messages.length, 100),
      pageToken,
    });
    messages.push(...(data.messages || []));
    pageToken = data.nextPageToken;
  } while (pageToken && messages.length < cfg.maxMessages);

  const emails = [];
  for (const { id } of messages) {
    const { data } = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    const headers = data.payload?.headers;
    emails.push({
      id,
      threadId: data.threadId,
      from: header(headers, 'From'),
      subject: header(headers, 'Subject'),
      date: new Date(Number(data.internalDate)).toISOString(),
      body: extractBody(data.payload) || data.snippet || '',
      anexos: await downloadPdfs(gmail, id, data.payload),
    });
  }
  return emails;
}

export async function markAsProcessed(gmail, messageIds) {
  if (!messageIds.length) return;
  const labelId = await getOrCreateLabelId(gmail, config.gmail.processedLabel);
  await gmail.users.messages.batchModify({
    userId: 'me',
    requestBody: { ids: messageIds, addLabelIds: [labelId] },
  });
}
