import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, CreditCard, Home } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { brl, dataBR } from '@/lib/format';
import { useDados } from '@/lib/dados';
import { useDialogs } from '@/lib/dialogs';
import { cn } from '@/lib/utils';

const SELO = {
  atrasada: ['Atrasada', 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'],
  vence_logo: ['Vence logo', 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'],
  pago: ['Pago', 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'],
};

export function ContasMes() {
  const { mes, versao } = useDados();
  const dialogs = useDialogs();
  const [dados, setDados] = useState(null);

  const carregar = useCallback(() => api(`/api/contas?mes=${mes}`).then(setDados).catch((e) => toast.error(e.message)), [mes]);
  useEffect(() => { carregar(); }, [carregar, versao]);

  const marcar = async (c, pago) => {
    setDados((d) => ({ ...d, contas: d.contas.map((x) => (x.chave === c.chave ? { ...x, pago_em: pago ? 'agora' : null } : x)) }));
    try {
      setDados(await api('/api/contas/pago', { method: 'PUT', body: { mes, chave: c.chave, pago } }));
    } catch (e) {
      toast.error(e.message);
      carregar();
    }
  };

  const editarDia = async (c) => {
    const r = await dialogs.prompt({
      title: `Vencimento de ${c.descricao}`,
      description: 'Dia do mês em que essa conta vence. Vale para todos os meses. Use 0 para remover.',
      label: 'Dia (1 a 31)',
      defaultValue: c.dia ? String(c.dia) : '',
    });
    if (r == null) return;
    const dia = Number(r);
    if (!Number.isInteger(dia) || dia < 0 || dia > 31) return toast.error('Dia inválido');
    try {
      setDados(await api('/api/contas/dia', { method: 'PUT', body: { mes, chave: c.chave, dia: dia || null } }));
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (!dados) return <Skeleton className="h-64" />;
  const alertas = [dados.atrasadas && `${dados.atrasadas} atrasada${dados.atrasadas > 1 ? 's' : ''}`, dados.vencendo && `${dados.vencendo} vencendo em até 3 dias`].filter(Boolean);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><CalendarCheck className="size-4 text-primary" /> Contas do mês</CardTitle>
        <CardDescription>
          {dados.contas.length
            ? <>Pago {brl(dados.pago)} de {brl(dados.total)} · falta <span className="font-medium text-foreground">{brl(dados.em_aberto)}</span>{alertas.length > 0 && <span className="text-rose-600 dark:text-rose-400"> · {alertas.join(', ')}</span>}</>
            : 'Nenhuma conta neste mês'}
        </CardDescription>
      </CardHeader>
      {dados.contas.length > 0 && (
        <CardContent className="grid gap-2">
          {dados.contas.map((c) => {
            const pago = !!c.pago_em;
            const selo = SELO[pago ? 'pago' : c.status];
            const Icone = c.tipo === 'cartao' ? CreditCard : Home;
            return (
              <label key={c.chave} className={cn('flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted/50', pago && 'opacity-60')}>
                <Checkbox checked={pago} onCheckedChange={(v) => marcar(c, v === true)} aria-label={`Marcar ${c.descricao} como pago`} />
                <Icone className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className={cn('truncate font-medium', pago && 'line-through')}>{c.descricao}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.tipo === 'fixo' ? (
                      <button type="button" className="underline-offset-2 hover:underline" onClick={(e) => { e.preventDefault(); editarDia(c); }}>
                        {c.vencimento ? `vence ${dataBR(c.vencimento)}` : 'definir vencimento'}
                      </button>
                    ) : (
                      <>{c.vencimento ? `vence ${dataBR(c.vencimento)}` : 'sem vencimento'}{c.parcial && ` · soma de ${c.compras} compra${c.compras > 1 ? 's' : ''}`}</>
                    )}
                  </div>
                </div>
                {selo && <Badge variant="outline" className={cn('hidden shrink-0 sm:inline-flex', selo[1])}>{selo[0]}</Badge>}
                <span className="shrink-0 whitespace-nowrap tabular-nums font-medium">{brl(c.valor)}</span>
              </label>
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}
