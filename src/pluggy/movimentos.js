import { planejadoNoMes } from '../summary/forecast.js';

const SAIDAS = new Set(['pix_enviado', 'debito']);
const BANCARIOS = new Set([...SAIDAS, 'pix_recebido']);
const dias = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
const igual = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

// Tira das contas correntes o que já é contado por outro caminho, para não contar duas vezes:
// - transferência entre contas da casa (sai de uma conta conectada e entra noutra);
// - pagamento de fatura de cartão (as compras já entram uma a uma ou pelo total da fatura);
// - débito de gasto fixo que já está no planejamento (apê, condomínio, Vivo...).
export function semMovimentosDuplicados(linhas, { planejamento = [], faturas = [] } = {}) {
  const removidos = [];
  const fora = new Set();
  const tirar = (t, motivo) => {
    fora.add(t);
    removidos.push({ ...t, motivo });
  };
  const bancarios = linhas.filter((t) => BANCARIOS.has(t.tipo));

  for (const s of bancarios.filter((t) => SAIDAS.has(t.tipo))) {
    const e = bancarios.find(
      (r) => r.tipo === 'pix_recebido' && !fora.has(r) && r.conta_ou_cartao !== s.conta_ou_cartao && igual(r.valor, s.valor) && dias(r.data, s.data) <= 1,
    );
    if (e) {
      tirar(s, 'transferência entre contas da casa');
      tirar(e, 'transferência entre contas da casa');
    }
  }

  const todasFaturas = [...faturas, ...linhas.filter((t) => t.tipo === 'fatura')];
  for (const s of bancarios.filter((t) => SAIDAS.has(t.tipo) && !fora.has(t))) {
    const f = todasFaturas.find((f) => igual(f.valor, s.valor) && dias(f.vencimento || f.data, s.data) <= 20);
    if (f) tirar(s, `pagamento da fatura ${f.conta_ou_cartao}`);
  }

  for (const t of bancarios) if (t.entre_titulares && !fora.has(t)) tirar(t, 'Pix entre contas do casal');

  // Cada gasto fixo casa com um único débito por mês: o de valor mais próximo (até 5% de diferença).
  const pares = [];
  for (const s of bancarios.filter((t) => SAIDAS.has(t.tipo) && !fora.has(t)))
    for (const p of planejamento)
      if (p.direcao === 'saida' && planejadoNoMes(p, s.data.slice(0, 7)) && igual(p.valor, s.valor, Math.max(1, p.valor * 0.05)))
        pares.push({ s, p, dif: Math.abs(p.valor - s.valor) / p.valor });
  const usados = new Set();
  for (const { s, p } of pares.sort((a, b) => a.dif - b.dif)) {
    const chave = `${p.id}|${s.data.slice(0, 7)}`;
    if (fora.has(s) || usados.has(chave)) continue;
    usados.add(chave);
    tirar(s, `gasto fixo já planejado: ${p.descricao}`);
  }

  return { linhas: linhas.filter((t) => !fora.has(t)), removidos };
}
