import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function Kpi({ titulo, valor, icone: Icone, tom = 'default', detalhe, className }) {
  const tons = {
    default: 'bg-primary/10 text-primary',
    verde: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    vermelho: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    ambar: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    azul: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  };
  return (
    <Card className={cn('gap-2 p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{titulo}</span>
        {Icone && <span className={cn('rounded-md p-1.5', tons[tom])}><Icone className="size-4" /></span>}
      </div>
      <div className="text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{valor}</div>
      {detalhe && <div className="text-xs text-muted-foreground">{detalhe}</div>}
    </Card>
  );
}
