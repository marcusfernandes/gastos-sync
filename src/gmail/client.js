import { google } from 'googleapis';
import { config } from '../config.js';

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];

export function createOAuthClient() {
  const { clientId, clientSecret, redirectUri } = config.gmail;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function createGmail() {
  const auth = createOAuthClient();
  auth.setCredentials({ refresh_token: config.gmail.refreshToken });
  return google.gmail({ version: 'v1', auth });
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

export function buildQuery({ query, lookbackDays, processedLabel }) {
  const label = processedLabel.replace(/[\s/]+/g, '-');
  return `${query} newer_than:${lookbackDays}d -label:${label}`;
}

export async function fetchBankEmails(gmail = createGmail()) {
  const cfg = config.gmail;
  const q = buildQuery(cfg);
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
