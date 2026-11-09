import { useState } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useDados } from '@/lib/dados';
import { useDialogs } from '@/lib/dialogs';

export function Categorias() {
  const { categorias, recarregar } = useDados();
  const dialogs = useDialogs();
  const [nome, setNome] = useState('');
  const run = async (fn, msg) => { try { await fn(); toast.success(msg); recarregar(); } catch (e) { toast.error(e.message); } };

  const criar = (e) => { e.preventDefault(); run(() => api('/api/categorias', { method: 'POST', body: { nome } }), 'Categoria criada').then(() => setNome('')); };
  const renomear = async (c) => {
    const novo = await dialogs.prompt({ title: `Renomear "${c}"`, label: 'Novo nome', defaultValue: c, description: 'Os gastos acompanham o novo nome.' });
    if (novo && novo !== c) run(() => api(`/api/categorias?nome=${encodeURIComponent(c)}`, { method: 'PATCH', body: { nome: novo } }), 'Categoria renomeada');
  };
  const excluir = async (c) => {
    if (await dialogs.confirm({ title: `Excluir "${c}"?`, description: 'Os gastos dela voltam para "Outros".', confirmText: 'Excluir', destructive: true })) {
      run(() => api(`/api/categorias?nome=${encodeURIComponent(c)}`, { method: 'DELETE' }), 'Categoria excluída');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Categorias</CardTitle>
        <CardDescription>A IA escolhe entre estas categorias; o que ela não reconhecer fica em "Outros". Para mudar a categoria de um gasto, use a lista de Transações ou de Parcelamentos.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form onSubmit={criar} className="flex gap-2">
          <Input className="h-9" required maxLength={40} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nova categoria (ex.: Pets)" />
          <Button type="submit" className="h-9"><Plus /> Criar</Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {categorias.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-1 pr-1 pl-3 text-sm">
              {c}
              {c !== 'Outros' && (
                <>
                  <Button variant="ghost" size="icon-xs" title="Renomear" onClick={() => renomear(c)}><Pencil /></Button>
                  <Button variant="ghost" size="icon-xs" title="Excluir" onClick={() => excluir(c)}><X /></Button>
                </>
              )}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
