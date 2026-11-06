import http from 'node:http';
import { config } from './config.js';
import { createStorage } from './storage/index.js';
import { gerarRelatorio, mesCorrente } from './summary/service.js';

const MES_RE = /^\d{4}-\d{2}$/;
const storage = await createStorage();

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET') return send(res, 405, { erro: 'Método não permitido' });
  if (url.pathname === '/health') return send(res, 200, { ok: true });

  const mes = url.searchParams.get('mes') || mesCorrente();
  const meses = Number(url.searchParams.get('meses') || 6);
  const saldoParam = url.searchParams.get('saldo_inicial');
  if (!MES_RE.test(mes)) return send(res, 400, { erro: 'mes deve ser YYYY-MM' });
  if (!Number.isInteger(meses) || meses < 1 || meses > 36) return send(res, 400, { erro: 'meses deve ser 1..36' });

  try {
    const rel = await gerarRelatorio({
      mes,
      meses,
      saldoInicial: saldoParam != null ? Number(saldoParam) : undefined,
      storage,
    });
    if (url.pathname === '/resumo') return send(res, 200, rel.resumo);
    if (url.pathname === '/projecao') return send(res, 200, rel.projecao);
    if (url.pathname === '/') return send(res, 200, rel);
    return send(res, 404, { erro: 'Rota não encontrada', rotas: ['/', '/resumo', '/projecao', '/health'] });
  } catch (err) {
    console.error(err);
    return send(res, 500, { erro: err.message });
  }
});

server.listen(config.summary.port, () => {
  console.log(`API de resumo em http://localhost:${config.summary.port} (/, /resumo, /projecao)`);
});
