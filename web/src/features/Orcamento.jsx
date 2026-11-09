import { useCallback, useEffect, useState } from 'react';
import { PiggyBank, Target } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { brl, parseValor } from '@/lib/format';
import { useDados } from '@/lib/dados';
import { cn } from '@/lib/utils';

const CORES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
const COR_NIVEL = { ok: 'bg-emerald-500', alerta: 'bg-amber-500', estourou: 'bg-rose-500' };
const TEXTO_NIVEL = { alerta: 'text-amber-600 dark:text-amber-400', estourou: 'text-rose-600 dark:text-rose-400' };

export function useOrcamento() {
  const { mes, versao } = useDados();
  const [dados, setDados] = useState(null);
  const carregar = useCallback(() => api(`/api/orcamentos?mes=${mes}`).then(setDados).catch((e) => toast.error(e.message)), [mes]);
  useEffect(() => { carregar(); }, [carregar, versao]);
  const salvar = async (limites) => {
    const r = await api('/api/orcamentos', { method: 'PUT', body: { mes, limites } });
    setDados(r);
    return r;
  };
  return { dados, salvar };
}

// Gastos do mês por categoria; com meta definida, a barra mostra quanto da meta já foi usado.
export function GastosPorCategoria() {
  const { dados, salvar } = useOrcamento();
  const [editando, setEditando] = useState(false);
  if (!dados) return <Skeleton className="h-64" />;
  const itens = dados.itens;
  const max = Math.max(...itens.map((i) => i.gasto), 1);
  const comMeta = itens.filter((i) => i.limite);
  const estouradas = comMeta.filter((i) => i.nivel === 'estourou').length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="grid gap-1.5">
          <CardTitle className="flex items-center gap-2 text-base"><PiggyBank className="size-4 text-primary" /> Gastos por categoria</CardTitle>
          <CardDescription>
            {dados.total_gasto ? `${brl(dados.total_gasto)} em gastos registrados no mês` : 'Sem gastos registrados neste mês'}
            {comMeta.length > 0 && <> · metas: {brl(dados.gasto_com_meta)} de {brl(dados.total_limite)}{estouradas > 0 && <span className="text-rose-600 dark:text-rose-400"> · {estouradas} estourada{estouradas > 1 ? 's' : ''}</span>}</>}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditando(true)}><Target /> Metas</Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        {itens.map((i, idx) => (
          <div key={i.categoria} className="grid gap-1">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{i.categoria}</span>
              <span className={cn('shrink-0 tabular-nums text-muted-foreground', TEXTO_NIVEL[i.nivel])}>
                {brl(i.gasto)}
                {i.limite ? <span className="text-xs"> de {brl(i.limite)}</span> : dados.total_gasto > 0 && <span className="text-xs"> · {Math.round((i.gasto / dados.total_gasto) * 100)}%</span>}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              {i.limite ? (
                <div className={cn('h-full rounded-full', COR_NIVEL[i.nivel])} style={{ width: `${Math.min(1, i.gasto / i.limite) * 100}%` }} />
              ) : (
                <div className="h-full rounded-full" style={{ width: `${(i.gasto / max) * 100}%`, background: CORES[idx % CORES.length] }} />
              )}
            </div>
          </div>
        ))}
        {!comMeta.length && itens.length > 0 && (
          <p className="text-xs text-muted-foreground">Defina metas por categoria para acompanhar o mês e receber aviso no Telegram ao chegar em 80% e 100%.</p>
        )}
      </CardContent>
      {editando && <EditarMetas aberto onOpenChange={setEditando} itens={itens} salvar={salvar} />}
    </Card>
  );
}

function EditarMetas({ aberto, onOpenChange, itens, salvar }) {
  const { categorias } = useDados();
  const [valores, setValores] = useState(() => Object.fromEntries(itens.filter((i) => i.limite).map((i) => [i.categoria, String(i.limite).replace('.', ',')])));
  const [salvando, setSalvando] = useState(false);
  const porCat = Object.fromEntries(itens.map((i) => [i.categoria, i]));
  const lista = [...categorias].sort((a, b) => (porCat[b]?.gasto || 0) - (porCat[a]?.gasto || 0));

  const enviar = async (e) => {
    e.preventDefault();
    const limites = {};
    for (const c of lista) {
      const v = valores[c]?.trim();
      const n = v ? parseValor(v) : 0;
      if (!Number.isFinite(n) || n < 0) return toast.error(`Valor inválido em ${c}`);
      if (n || porCat[c]?.limite) limites[c] = n;
    }
    setSalvando(true);
    try {
      await salvar(limites);
      toast.success('Metas salvas');
      onOpenChange(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Metas mensais por categoria</DialogTitle>
          <DialogDescription>Valem para todos os meses. Deixe em branco para não ter meta. O bot avisa ao chegar em 80% e 100%.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="grid gap-2">
          {lista.map((c) => (
            <div key={c} className="grid grid-cols-[1fr_8rem] items-center gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{c}</div>
                <div className="text-xs text-muted-foreground">este mês {brl(porCat[c]?.gasto || 0)} · média 3 meses {brl(porCat[c]?.media || 0)}</div>
              </div>
              <Input className="h-9 text-right tabular-nums" inputMode="decimal" placeholder="sem meta" value={valores[c] ?? ''} onChange={(e) => setValores((v) => ({ ...v, [c]: e.target.value }))} />
            </div>
          ))}
          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={salvando}>Salvar metas</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
