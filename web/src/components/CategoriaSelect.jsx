import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export const NOVA = '__nova';

export function CategoriaSelect({ value, categorias, onChange, className, permitirNova = true, disabled }) {
  const opcoes = categorias.includes(value) || !value ? categorias : [value, ...categorias];
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger size="sm" className={cn('h-8 w-full min-w-36 max-w-48', className)}>
        <SelectValue placeholder="Categoria" />
      </SelectTrigger>
      <SelectContent>
        {opcoes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
        {permitirNova && (
          <>
            <SelectSeparator />
            <SelectItem value={NOVA}>+ Nova categoria…</SelectItem>
          </>
        )}
      </SelectContent>
    </Select>
  );
}
