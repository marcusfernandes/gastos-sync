import { useEffect, useState } from 'react';
import { Landmark, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { brl, dataHoraBR, parseValor } from '@/lib/format';
import { useDados } from '@/lib/dados';

export function SaldoAtual() {
  const { saldo, recarregar } = useDados();
  const [valor, setValor] = useState('');
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setValor(saldo.valor ?? ''); }, [saldo.valor]);

  const salvar = async (e) => {
    e.preventDefault();
    const n = parseValor(valor);
    if (!Number.isFinite(n)) return toast.error('Valor inválido');
    setSalvando(true);
    try {
      await api('/api/saldo', { method: 'PUT', body: { valor: n } });
      toast.success('Saldo atual salvo');
      recarregar();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSalvando(false);
    }
  };

  const vazio = saldo.valor === null || saldo.valor === undefined;
  return (
    <Card className={vazio ? 'border-amber-500/50' : ''}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Landmark className="size-4 text-primary" /> Saldo atual em conta</CardTitle>
        <CardDescription>
          {vazio
            ? 'Informe quanto vocês têm hoje somando as contas. A projeção parte desse valor (hoje está em R$ 0).'
            : `${brl(saldo.valor)} · atualizado em ${dataHoraBR(saldo.atualizado_em)}${saldo.fonte ? ` · ${saldo.fonte}${saldo.contas ? ` (${saldo.contas})` : ''}` : ''}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={salvar} className="flex gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
            <Input inputMode="decimal" className="h-9 pl-8 tabular-nums" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
          </div>
          <Button type="submit" className="h-9" disabled={salvando}><Save /> Salvar</Button>
        </form>
      </CardContent>
    </Card>
  );
}
