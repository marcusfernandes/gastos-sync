const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const brlCurto = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1000) return `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
};
export const eixoBRL = (n) => {
  const v = Number(n || 0);
  return Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
};
export const pct = (n) => `${n > 0 ? '+' : ''}${(n * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`;

export const mesDe = (d) => String(d ?? '').slice(0, 7);
export const mesBR = (m) => {
  if (!m) return '—';
  const [y, mm] = String(m).split('-');
  return `${MESES[Number(mm) - 1]}/${y}`;
};
export const mesBRCurto = (m) => {
  const [y, mm] = String(m).split('-');
  return `${MESES[Number(mm) - 1]}/${y.slice(2)}`;
};
export const dataBR = (d) => {
  if (!d) return '—';
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return `${dd}/${m}/${y}`;
};
export const dataHoraBR = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export const hojeMes = () => {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
};
export const addMeses = (mes, n) => {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
export const semParcela = (s) => String(s || '').replace(/\s*\(parcela.*\)$/i, '');
export const parseValor = (s) => {
  const t = String(s ?? '').trim().replace(/[R$\s]/g, '');
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};
