import { useState } from 'react';
import { CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { hojeMes, mesBR } from '@/lib/format';

const NOMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// Seletor de mês com calendário (valor interno YYYY-MM, exibido como nov/2026).
export function MonthPicker({ value, onChange, placeholder = 'Escolha o mês', clearable = false, className, id, min }) {
  const [aberto, setAberto] = useState(false);
  const [ano, setAno] = useState(() => Number((value || hojeMes()).slice(0, 4)));
  const atual = hojeMes();

  return (
    <Popover open={aberto} onOpenChange={(o) => { setAberto(o); if (o) setAno(Number((value || atual).slice(0, 4))); }}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" className={cn('h-9 justify-start gap-2 font-normal', !value && 'text-muted-foreground', className)}>
          <CalendarIcon className="size-4 opacity-70" />
          <span className="flex-1 text-left">{value ? mesBR(value) : placeholder}</span>
          {clearable && value && (
            <X
              className="size-3.5 opacity-60 hover:opacity-100"
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="mb-2 flex items-center justify-between">
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setAno(ano - 1)} aria-label="Ano anterior"><ChevronLeft /></Button>
          <span className="text-sm font-medium">{ano}</span>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setAno(ano + 1)} aria-label="Próximo ano"><ChevronRight /></Button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {NOMES.map((n, i) => {
            const m = `${ano}-${String(i + 1).padStart(2, '0')}`;
            const sel = m === value;
            return (
              <Button
                key={m}
                type="button"
                size="sm"
                variant={sel ? 'default' : 'ghost'}
                disabled={min && m < min}
                className={cn(!sel && m === atual && 'ring-1 ring-primary/50')}
                onClick={() => { onChange(m); setAberto(false); }}
              >
                {n}
              </Button>
            );
          })}
        </div>
        <Button type="button" variant="link" size="sm" className="mt-1 w-full" onClick={() => { onChange(atual); setAberto(false); }}>
          Mês atual
        </Button>
      </PopoverContent>
    </Popover>
  );
}
