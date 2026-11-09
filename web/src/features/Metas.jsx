import { useState } from 'react';
import { PiggyBank, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MonthPicker } from '@/components/MonthPicker';
import { api } from '@/lib/api';
import { addMeses, brl, hojeMes, mesBR, parseValor } from '@/lib/format';
import { useDados } from '@/lib/dados';
import { useDialogs } from '@/lib/dialogs';

const VAZIO = { id: null, nome: '', alvo: '', guardado: '', prazo: '' };
const valorTexto = (n) => (n ? String(n).replace('.', ',') : '');

export function Metas() {
  const { relatorio, mes, recarregar } = useDados();
  const dialogs = useDialogs();
  const [form, setForm] = useState(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const itens = relatorio?.metas?.itens ?? [];
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));
  const limpar = ({ id, nome, alvo, guardado, prazo }) => ({ id, nome, alvo, guardado, prazo });

  const gravar = async (lista, msg) => {
    setSalvando(true);
    try {
      await api('/api/metas', { method: 'PUT', body: { metas: lista } });
      toast.success(msg);
      setForm(VAZIO);
      recarregar();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSalvando(false);
    }
  };
  const salvar = (e) => {
    e.preventDefault();
    const meta = { id: form.id, nome: form.nome, alvo: parseValor(form.alvo), guardado: parseValor(form.guardado || '0'), prazo: form.prazo };
    const lista = form.id ? itens.map((m) => (m.id === form.id ? meta : limpar(m))) : [...itens.map(limpar), meta];
    gravar(lista, form.id ? 'Meta atualizada' : 'Meta criada');
  };
  const remover = async (m) => {
    if (!(await dialogs.confirm({ title: `Remover a meta "${m.nome}"?`, confirmText: 'Remover', destructive: true }))) return;
    gravar(itens.filter((x) => x.id !== m.id).map(limpar), 'Meta removida');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><PiggyBank className="size-4 text-primary" /> Metas de poupança</CardTitle>
        <CardDescription>
          {itens.length
            ? <>Para chegar nas metas, guarde <b className="text-foreground">{brl(relatorio.metas.aporte_total)}/mês</b>. A projeção de saldo já desconta esse valor.</>
            : 'Reserva de emergência, mudança... Informe o valor-alvo e o prazo: o painel calcula quanto guardar por mês e já desconta isso da projeção.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form onSubmit={salvar} className="grid grid-cols-2 items-end gap-3 rounded-lg border bg-muted/30 p-3 md:grid-cols-5">
          <Campo label="Meta" className="col-span-2 md:col-span-1"><Input className="h-9" required value={form.nome} onChange={set('nome')} placeholder="Ex.: Mudança" /></Campo>
          <Campo label="Valor-alvo"><Input className="h-9" required inputMode="decimal" value={form.alvo} onChange={set('alvo')} placeholder="15.000,00" /></Campo>
          <Campo label="Já guardado"><Input className="h-9" inputMode="decimal" value={form.guardado} onChange={set('guardado')} placeholder="0,00" /></Campo>
          <Campo label="Prazo"><MonthPicker className="h-9 w-full" value={form.prazo} onChange={set('prazo')} min={addMeses(hojeMes(), 1)} /></Campo>
          <div className="flex gap-2">
            <Button type="submit" className="h-9 flex-1" disabled={salvando || !form.prazo}>{form.id ? 'Salvar' : 'Adicionar'}</Button>
            {form.id && <Button type="button" variant="ghost" className="h-9" onClick={() => setForm(VAZIO)}>Cancelar</Button>}
          </div>
        </form>
        {itens.map((m) => (
          <div key={m.id} className="grid gap-2 rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">{m.nome}</span>
              {m.falta === 0 ? <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Concluída</Badge>
                : m.vencida ? <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300">Prazo vencido</Badge> : null}
              <span className="ml-auto text-muted-foreground tabular-nums">{brl(m.guardado)} de {brl(m.alvo)}</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon-sm" title="Editar" onClick={() => setForm({ id: m.id, nome: m.nome, alvo: valorTexto(m.alvo), guardado: valorTexto(m.guardado), prazo: m.prazo })}><Pencil /></Button>
                <Button variant="ghost" size="icon-sm" title="Remover" onClick={() => remover(m)}><Trash2 /></Button>
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(m.progresso * 100)}%` }} /></div>
            <div className="text-xs text-muted-foreground">
              {m.falta === 0 ? 'Meta atingida.' : m.vencida
                ? `Faltam ${brl(m.falta)} e o prazo (${mesBR(m.prazo)}) já passou. Edite o prazo.`
                : `Faltam ${brl(m.falta)} · guardar ${brl(m.aporte_mensal)}/mês de ${mesBR(addMeses(mes, 1))} a ${mesBR(m.prazo)} (${m.meses_restantes} ${m.meses_restantes > 1 ? 'meses' : 'mês'}). Atualize o "já guardado" quando depositar.`}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Campo({ label, children, className }) {
  return <div className={`grid gap-1.5 ${className || ''}`}><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}
