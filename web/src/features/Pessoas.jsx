import { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { brl, mesBR } from '@/lib/format';
import { useDados } from '@/lib/dados';
import { cn } from '@/lib/utils';

export const CASAL = 'Casal';

export function usePessoas() {
  const { planejamento } = useDados();
  return useMemo(() => [...new Set(planejamento.filter((p) => p.direcao === 'entrada' && p.responsavel).map((p) => p.responsavel))].sort(), [planejamento]);
}

export function PessoaSelect({ t, onSalvo, className }) {
  const pessoas = usePessoas();
  const [valor, setValor] = useState(t.responsavel || CASAL);
  useEffect(() => setValor(t.responsavel || CASAL), [t.responsavel]);
  const mudar = async (v) => {
    const anterior = valor;
    setValor(v);
    try {
      await api(`/api/transacoes?id=${t.id}`, { method: 'PATCH', body: { responsavel: v } });
      onSalvo?.(v);
    } catch (e) {
      setValor(anterior);
      toast.error(e.message);
    }
  };
  return (
    <Select value={valor} onValueChange={mudar}>
      <SelectTrigger size="sm" className={cn('h-8 w-28', className)}><SelectValue /></SelectTrigger>
      <SelectContent>
        {[...pessoas, CASAL].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function GastosPorPessoa() {
  const { mes, versao } = useDados();
  const [d, setD] = useState(null);
  const [modo, setModo] = useState('proporcional');
  useEffect(() => { api(`/api/pessoas?mes=${mes}`).then(setD).catch((e) => toast.error(e.message)); }, [mes, versao]);
  const total = d?.grupos.reduce((a, g) => a + g.total, 0) || 0;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1.5">
          <CardTitle className="flex items-center gap-2 text-base"><Users className="size-4 text-primary" /> Gastos por pessoa</CardTitle>
          <CardDescription>Em {mesBR(mes)}. Todo gasto começa como do casal; troque em Transações, na coluna "De quem".</CardDescription>
        </div>
        <Select value={modo} onValueChange={setModo}>
          <SelectTrigger size="sm" className="h-8 w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="proporcional">Casal dividido pela renda</SelectItem>
            <SelectItem value="meio">Casal dividido meio a meio</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {!d ? <Skeleton className="h-32" /> : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="grid content-start gap-2">
              {d.grupos.map((g) => (
                <div key={g.pessoa} className="grid gap-1 text-sm">
                  <div className="flex justify-between gap-2"><span className="font-medium">{g.pessoa}</span><span className="tabular-nums">{brl(g.total)} <span className="text-xs text-muted-foreground">· {g.lancamentos}</span></span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full', g.pessoa === CASAL ? 'bg-muted-foreground/40' : 'bg-primary')} style={{ width: `${total ? Math.round((g.total / total) * 100) : 0}%` }} /></div>
                </div>
              ))}
            </div>
            <div className="grid content-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="text-xs font-medium text-muted-foreground">Divisão do mês</div>
              {d.divisao.map((p) => {
                const casal = modo === 'meio' ? p.casal_meio_a_meio : p.casal_proporcional;
                return (
                  <div key={p.pessoa} className="flex items-baseline justify-between gap-2">
                    <span>{p.pessoa}{modo === 'proporcional' && <span className="text-xs text-muted-foreground"> ({Math.round(p.percentual_renda * 100)}% da renda)</span>}</span>
                    <span className="text-right tabular-nums">
                      <b>{brl(p.proprio + casal)}</b>
                      <span className="block text-xs text-muted-foreground">{brl(p.proprio)} próprios + {brl(casal)} do casal</span>
                    </span>
                  </div>
                );
              })}
              {!d.divisao.length && <span className="text-muted-foreground">Cadastre quem recebe em Receitas fixas para dividir.</span>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
