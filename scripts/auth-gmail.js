// Gera o GOOGLE_REFRESH_TOKEN uma única vez (fluxo OAuth com loopback local).
import http from 'node:http';
import { google } from 'googleapis';
import { GMAIL_SCOPES } from '../src/gmail/client.js';

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:53682/oauth2callback';
if (!clientId || !clientSecret) {
  console.error('Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env antes de rodar.');
  process.exit(1);
}

const scopes = [...GMAIL_SCOPES];
if ((process.env.STORAGE_BACKEND || '').toLowerCase() === 'sheets') {
  scopes.push('https://www.googleapis.com/auth/spreadsheets');
}

const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
const url = oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: scopes });
const { port, pathname } = new URL(redirectUri);

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, redirectUri);
  if (reqUrl.pathname !== pathname) {
    res.writeHead(404).end();
    return;
  }
  const code = reqUrl.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('Código OAuth ausente.');
    return;
  }
  try {
    const { tokens } = await oauth.getToken(code);
    res.end('Autorizado! Pode fechar esta aba e voltar ao terminal.');
    console.log('\nAdicione ao seu .env:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  } catch (err) {
    res.writeHead(500).end('Falha ao trocar o código por tokens.');
    console.error(err.message);
  } finally {
    server.close();
  }
});

server.listen(Number(port), () => {
  console.log('Abra esta URL no navegador e autorize o acesso:\n');
  console.log(url);
});
