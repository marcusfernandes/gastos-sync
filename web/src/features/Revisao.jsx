import { useCallback, useEffect, useState } from 'react';
import { Check, Inbox, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CategoriaSelect } from '@/components/CategoriaSelect';
import { api } from '@/lib/api';
import { brl, dataBR, mesBR } from '@/lib/format';
import { useDados, useMudarCategoria } from '@/lib/dados';
import { useDialogs } from '@/lib/dialogs';

const SELO = {
  repetida: ['Repetida?', 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'],
  alto: ['Valor alto', 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'],
  outros: ['Sem categoria', 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'],
};

export function CaixaRevisao() {
  const { mes, versao, categorias, recarregar } = useDados();
  const mudar = useMudarCategoria();
  const dialogs = useDialogs();
  const [itens, setItens] = useState(null);
  const carregar = useCallback(() => api(`/api/revisao?mes=${mes}`).then((r) => setItens(r.itens)).catch((e) => toast.error(e.message)), [mes]);
  useEffect(() => { carregar(); }, [carregar, versao]);

  const tirar = (id) => setItens((l) => l.filter((i) => i.transacao.id !== id));
  const ok = async (ids) => {
    try {
      await api('/api/revisao/ok', { method: 'POST', body: { ids } });
      setItens((l) => l.filter((i) => !ids.includes(i.transacao.id)));
    } catch (e) {
      toast.error(e.message);
    }
  };
  const apagar = async (t) => {
    if (!(await dialogs.confirm({ title: 'Apagar lançamento?', description: `${t.estabelecimento} · ${brl(t.valor)} · ${dataBR(t.data)}`, confirmText: 'Apagar', destructive: true }))) return;
    try {
      await api(`/api/transacoes?id=${t.id}`, { method: 'DELETE' });
      tirar(t.id);
      recarregar();
    } catch (e) {
      toast.error(e.message);
    }
  };
  const categoria = async (t, c) => {
    if (await mudar({ id: t.id, estabelecimento: t.estabelecimento, categoria: c })) await ok([t.id]);
  };

  if (!itens?.length) {
    return itens ? (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Inbox className="size-4 text-primary" /> Caixa de revisão</CardTitle>
          <CardDescription>Tudo conferido em {mesBR(mes)}.</CardDescription>
        </CardHeader>
      </Card>
    ) : null;
  }
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="grid gap-1.5">
          <CardTitle className="flex items-center gap-2 text-base"><Inbox className="size-4 text-primary" /> Caixa de revisão</CardTitle>
          <CardDescription>{itens.length} {itens.length > 1 ? 'lançamentos' : 'lançamento'} de {mesBR(mes)} para conferir. Também dá para revisar pelo Telegram com /revisar.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => ok(itens.map((i) => i.transacao.id))}><Check /> Tudo certo</Button>
      </CardHeader>
      <CardContent className="grid gap-2">
        {itens.map(({ transacao: t, tipo, motivo }) => (
          <div key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-sm">
            <div className="min-w-0 flex-1 basis-56">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{t.estabelecimento}</span>
                <Badge variant="outline" className={`shrink-0 ${SELO[tipo][1]}`}>{SELO[tipo][0]}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">{dataBR(t.data)} · {t.conta_ou_cartao} · {motivo}</div>
            </div>
            <CategoriaSelect className="h-8 w-40" value={t.categoria} categorias={categorias} onChange={(c) => categoria(t, c)} />
            <span className="w-24 shrink-0 text-right font-medium whitespace-nowrap tabular-nums">{brl(t.valor)}</span>
            <div className="flex shrink-0 gap-1">
              <Button variant="ghost" size="icon-sm" title="Está certo" onClick={() => ok([t.id])}><Check /></Button>
              <Button variant="ghost" size="icon-sm" title="Apagar" onClick={() => apagar(t)}><Trash2 /></Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
