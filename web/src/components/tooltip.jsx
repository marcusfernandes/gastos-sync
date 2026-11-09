import { brl } from '@/lib/format';

// Formatter para ChartTooltipContent com valores em R$.
export const formatarBRL = (config = {}) => function Linha(value, name, item) {
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: item.color || item.payload?.fill }} />
        {config[name]?.label ?? name}
      </span>
      <span className="font-mono font-medium tabular-nums">{brl(value)}</span>
    </div>
  );
};
