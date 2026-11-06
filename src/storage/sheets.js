import { google } from 'googleapis';
import { config } from '../config.js';
import { createOAuthClient } from '../gmail/client.js';
import { TRANSACAO_COLUNAS, uniqueByKey } from './index.js';
import { parseData, parseValor } from '../parser/normalize.js';

const PLANEJAMENTO_COLUNAS = ['descricao', 'direcao', 'valor', 'categoria', 'recorrente', 'inicio', 'fim'];

function rowsToObjects(values, colunas) {
  return (values || []).slice(1).map((row) =>
    Object.fromEntries(colunas.map((c, i) => [c, row[i] === '' || row[i] == null ? null : row[i]])),
  );
}

export function createSheetsStorage(sheetsApi) {
  const { spreadsheetId, sheetName } = config.sheets;
  const sheets =
    sheetsApi ??
    (() => {
      const auth = createOAuthClient();
      auth.setCredentials({ refresh_token: config.gmail.refreshToken });
      return google.sheets({ version: 'v4', auth });
    })();

  async function read(range) {
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    return data.values || [];
  }

  async function ensureHeader() {
    const values = await read(`${sheetName}!A1:J1`);
    if (!values.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [TRANSACAO_COLUNAS] },
      });
    }
  }

  return {
    async saveTransacoes(rows) {
      await ensureHeader();
      const keyCol = String.fromCharCode(65 + TRANSACAO_COLUNAS.indexOf('dedupe_key'));
      const existing = new Set((await read(`${sheetName}!${keyCol}2:${keyCol}`)).map((r) => r[0]));
      const novos = uniqueByKey(rows).filter((r) => !existing.has(r.dedupe_key));
      if (novos.length) {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${sheetName}!A1`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: novos.map((r) => TRANSACAO_COLUNAS.map((c) => r[c] ?? '')) },
        });
      }
      return { inserted: novos, skipped: rows.length - novos.length };
    },

    async listTransacoes({ desde } = {}) {
      const all = rowsToObjects(await read(`${sheetName}!A:J`), TRANSACAO_COLUNAS).map((t) => ({
        ...t,
        data: parseData(String(t.data)),
        vencimento: t.vencimento ? parseData(String(t.vencimento)) : null,
        valor: parseValor(t.valor),
      }));
      return desde ? all.filter((t) => t.data >= desde || (t.vencimento && t.vencimento >= desde)) : all;
    },

    async listPlanejamento() {
      const values = await read('planejamento!A:G').catch(() => []);
      return rowsToObjects(values, PLANEJAMENTO_COLUNAS).map((p) => ({
        ...p,
        valor: parseValor(p.valor),
        inicio: parseData(String(p.inicio)),
        fim: p.fim ? parseData(String(p.fim)) : null,
        recorrente: !['false', 'não', 'nao', '0'].includes(String(p.recorrente).toLowerCase()),
      }));
    },
  };
}
