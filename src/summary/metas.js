const round = (n) => Math.round(n * 100) / 100;
const mesesEntre = (de, ate) => {
  const [y1, m1] = de.split('-').map(Number);
  const [y2, m2] = ate.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
};

export async function lerMetas(storage) {
  if (!storage.getConfig) return [];
  return JSON.parse((await storage.getConfig('metas_poupanca')) || '[]');
}

// Quanto guardar por mês, do mês seguinte ao atual até o prazo (inclusive), para chegar ao alvo.
export function aporteMensal(meta, mesAtual) {
  const falta = Math.max(0, meta.alvo - (meta.guardado || 0));
  if (!falta) return 0;
  return round(falta / Math.max(1, mesesEntre(mesAtual, meta.prazo)));
}

export function resumoMetas(metas, mesAtual) {
  const itens = metas.map((m) => {
    const aporte = aporteMensal(m, mesAtual);
    return {
      ...m,
      aporte_mensal: aporte,
      falta: round(Math.max(0, m.alvo - (m.guardado || 0))),
      progresso: m.alvo > 0 ? Math.min(1, (m.guardado || 0) / m.alvo) : 0,
      meses_restantes: Math.max(0, mesesEntre(mesAtual, m.prazo)),
      vencida: m.prazo <= mesAtual && aporte > 0,
    };
  });
  return { itens, aporte_total: round(itens.filter((i) => !i.vencida).reduce((a, i) => a + i.aporte_mensal, 0)) };
}

// Aporte previsto em um mês futuro da projeção.
export function aporteNoMes(metas, mesAtual, mes) {
  return round(metas.filter((m) => mes > mesAtual && mes <= m.prazo).reduce((a, m) => a + aporteMensal(m, mesAtual), 0));
}

export function validarMetas(lista) {
  if (!Array.isArray(lista)) throw new Error('metas deve ser uma lista');
  return lista.map((m, i) => {
    const nome = String(m.nome || '').trim();
    const alvo = Number(m.alvo);
    const guardado = Number(m.guardado || 0);
    if (!nome) throw new Error(`Meta ${i + 1}: nome é obrigatório`);
    if (!(alvo > 0)) throw new Error(`${nome}: valor-alvo inválido`);
    if (!(guardado >= 0)) throw new Error(`${nome}: valor guardado inválido`);
    if (!/^\d{4}-\d{2}$/.test(m.prazo || '')) throw new Error(`${nome}: prazo deve ser YYYY-MM`);
    return { id: m.id || `${Date.now().toString(36)}${i}`, nome, alvo: round(alvo), guardado: round(guardado), prazo: m.prazo };
  });
}
