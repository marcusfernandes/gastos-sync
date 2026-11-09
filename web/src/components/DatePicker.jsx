import { useState } from 'react';
import { ptBR } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { dataBR } from '@/lib/format';

const paraISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const deISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

// Seletor de data com calendário (valor interno YYYY-MM-DD, exibido dd/mm/aaaa).
export function DatePicker({ value, onChange, placeholder = 'dd/mm/aaaa', className, id }) {
  const [aberto, setAberto] = useState(false);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" className={cn('h-9 justify-start gap-2 font-normal', !value && 'text-muted-foreground', className)}>
          <CalendarIcon className="size-4 opacity-70" />
          {value ? dataBR(value) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={ptBR}
          captionLayout="dropdown"
          selected={value ? deISO(value) : undefined}
          defaultMonth={value ? deISO(value) : undefined}
          onSelect={(d) => { if (d) { onChange(paraISO(d)); setAberto(false); } }}
        />
      </PopoverContent>
    </Popover>
  );
}
