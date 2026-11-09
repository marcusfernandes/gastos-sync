import { cartaoDe } from './parser/normalize.js';

// A mesma movimentação pode chegar por e-mail/fatura e pelo Open Finance, com nomes diferentes.
// Considera repetida quando é do mesmo banco, mesmo valor e data próxima (ou mesma fatura).
const DIAS = 5;
const banco = (t) => cartaoDe(t);
const ehPluggy = (t) => String(t.origem_email_id || '').startsWith('pluggy:');
const dias = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
const MOVIMENTO = new Set(['compra', 'debito', 'pix_enviado', 'pix_recebido']);

function mesma(n, e) {
  if (banco(n) !== banco(e) || ehPluggy(n) === ehPluggy(e)) return false;
  if (n.tipo === 'fatura' || e.tipo === 'fatura') {
    return (
      n.tipo === e.tipo &&
      (n.vencimento || n.data).slice(0, 7) === (e.vencimento || e.data).slice(0, 7) &&
      Math.abs(n.valor - e.valor) <= 1
    );
  }
  if (!MOVIMENTO.has(n.tipo) || !MOVIMENTO.has(e.tipo)) return false;
  if (Math.abs(n.valor - e.valor) > 0.02) return false;
  const mes = (t) => t.vencimento?.slice(0, 7);
  if (mes(n) && mes(e) && mes(n) !== mes(e)) return false;
  // Só compara parcelas quando as duas fontes trazem (a fatura em PDF às vezes vem sem o "X/Y").
  if (n.parcelas_total && e.parcelas_total) {
    // Cada banco data a parcela de um jeito (data da compra ou da fatura): vale o número e a fatura.
    if (n.parcela_atual !== e.parcela_atual || n.parcelas_total !== e.parcelas_total) return false;
    if (mes(n) && mes(e)) return true;
  }
  return dias(n.data, e.data) <= DIAS;
}

// Remove de "novas" o que já existe vindo da outra fonte; cada existente casa com uma só nova.
export function semDuplicatasCruzadas(novas, existentes) {
  const usados = new Set();
  const repetidas = [];
  const ok = novas.filter((n) => {
    const i = existentes.findIndex((e, j) => !usados.has(j) && mesma(n, e));
    if (i < 0) return true;
    usados.add(i);
    repetidas.push({ nova: n, existente: existentes[i] });
    return false;
  });
  return { novas: ok, repetidas };
}
