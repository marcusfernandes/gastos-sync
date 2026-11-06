// Uso: npm run resumo -- [--mes 2026-11] [--meses 6] [--saldo 15000] [--json]
import { parseArgs } from 'node:util';
import { gerarRelatorio } from './service.js';

const { values } = parseArgs({
  options: {
    mes: { type: 'string' },
    meses: { type: 'string', default: '6' },
    saldo: { type: 'string' },
    json: { type: 'boolean', default: false },
  },
});

const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const rel = await gerarRelatorio({
  mes: values.mes,
  meses: Number(values.meses),
  saldoInicial: values.saldo ? Number(values.saldo) : undefined,
});

if (values.json) {
  console.log(JSON.stringify(rel, null, 2));
} else {
  const { resumo: r, projecao: p } = rel;
  console.log(`\nResumo de ${r.mes}`);
  console.log(`  Entradas cadastradas:   ${brl(r.entradas.cadastradas)}  (Pix recebidos: ${brl(r.entradas.recebidas_pix)})`);
  console.log(`  Gastos registrados:     ${brl(r.gastos.registrados)}`);
  console.log(`  Fixos planejados:       ${brl(r.gastos.fixos_planejados)}`);
  console.log(`  Pontuais planejados:    ${brl(r.gastos.pontuais_planejados)}`);
  console.log(`  Faturas vencendo:       ${brl(r.faturas.total_vencendo)}`);
  console.log(`  Saldo estimado do mês:  ${brl(r.saldo_estimado)}`);
  console.log('\n  Por categoria:');
  for (const [cat, v] of Object.entries(r.gastos.por_categoria)) console.log(`    ${cat.padEnd(20)} ${brl(v)}`);

  console.log(`\nProjeção (saldo inicial ${brl(p.saldo_inicial)}, variável médio ${brl(p.media_variavel_mensal)}/mês)`);
  console.table(
    p.meses.map((m) => ({
      mês: m.mes,
      entradas: brl(m.entradas),
      fixos: brl(m.gastos_fixos),
      variáveis: brl(m.gastos_variaveis_estimados),
      pontuais: brl(m.gastos_pontuais),
      saldo: brl(m.saldo_projetado),
    })),
  );
  if (p.alerta) console.log(`ATENÇÃO: ${p.alerta}`);
}
