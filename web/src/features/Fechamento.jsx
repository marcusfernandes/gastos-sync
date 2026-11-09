import { useEffect, useState } from 'react';
import { CalendarCheck, TrendingDown, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MonthPicker } from '@/components/MonthPicker';
import { api } from '@/lib/api';
import { addMeses, brl, hojeMes, mesBR } from '@/lib/format';
import { cn } from '@/lib/utils';

const cor = (n) => (n < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400');
const sinal = (n) => `${n > 0 ? '+' : ''}${brl(n)}`;

export function Fechamento() {
  const [mes, setMes] = useState(addMeses(hojeMes(), -1));
  const [f, setF] = useState(null);
  useEffect(() => {
    setF(null);
    api(`/api/fechamento?mes=${mes}`).then(setF).catch((e) => toast.error(e.message));
  }, [mes]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1.5">
          <CardTitle className="flex items-center gap-2 text-base"><CalendarCheck className="size-4 text-primary" /> Fechamento do mês</CardTitle>
          <CardDescription>No dia 1º o bot manda este resumo no Telegram. Também dá para pedir com /fechamento.</CardDescription>
        </div>
        <MonthPicker className="h-8 w-36" value={mes} onChange={(m) => m && setMes(m)} />
      </CardHeader>
      <CardContent>
        {!f ? <Skeleton className="h-48" /> : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="grid content-start gap-2 text-sm">
              <Linha rotulo="Entradas" valor={brl(f.entradas)} />
              <Linha rotulo="Saídas" valor={brl(f.saidas)} extra={`${sinal(f.saidas - f.anterior.saidas)} vs ${mesBR(f.anterior.mes)}`} />
              <Linha rotulo="Resultado" valor={<span className={cor(f.resultado)}>{brl(f.resultado)}</span>} extra={`${mesBR(f.anterior.mes)}: ${brl(f.anterior.resultado)}`} />
              <Linha rotulo="Assinaturas" valor={`${brl(f.assinaturas.total_mensal)}/mês`} />
              {f.projecao.menor_saldo && (
                <div className={cn('mt-1 rounded-lg border px-3 py-2 text-xs', f.projecao.menor_saldo.valor < 0 ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300')}>
                  {f.projecao.menor_saldo.valor < 0
                    ? `Projeção: o saldo fica negativo e chega a ${brl(f.projecao.menor_saldo.valor)} em ${mesBR(f.projecao.menor_saldo.mes)}.`
                    : `Projeção: saldo positivo nos próximos 6 meses (menor: ${brl(f.projecao.menor_saldo.valor)}).`}
                </div>
              )}
              {f.faturas_divergentes.map((d) => <div key={d.conta_ou_cartao} className="text-xs text-amber-700 dark:text-amber-300">Fatura {d.conta_ou_cartao} não bate: diferença de {brl(d.diferenca)}</div>)}
            </div>
            <div className="min-w-0">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Onde mais foi</div>
              <div className="grid gap-1 text-sm">
                {f.categorias.slice(0, 6).map((c) => (
                  <div key={c.categoria} className="flex justify-between gap-2"><span className="truncate">{c.categoria}</span><span className="tabular-nums">{brl(c.atual)}</span></div>
                ))}
                {!f.categorias.length && <span className="text-muted-foreground">Sem gastos registrados.</span>}
              </div>
            </div>
            <div className="min-w-0">
              <div className="mb-2 text-xs font-medium text-muted-foreground">O que mudou vs {mesBR(f.anterior.mes)}</div>
              <div className="grid gap-1 text-sm">
                {[...f.altas, ...f.quedas].map((c) => (
                  <div key={c.categoria} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {c.diferenca > 0 ? <TrendingUp className="size-3.5 shrink-0 text-rose-500" /> : <TrendingDown className="size-3.5 shrink-0 text-emerald-500" />}
                      <span className="truncate">{c.categoria}</span>
                    </span>
                    <span className={cn('tabular-nums', c.diferenca > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>{sinal(c.diferenca)}</span>
                  </div>
                ))}
                {!f.altas.length && !f.quedas.length && <span className="text-muted-foreground">Nenhuma mudança acima de R$ 50.</span>}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Linha({ rotulo, valor, extra }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b pb-1.5 last:border-0">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="text-right"><span className="font-medium tabular-nums">{valor}</span>{extra && <span className="block text-xs text-muted-foreground">{extra}</span>}</span>
    </div>
  );
}
