import { useMemo, useState } from 'react';
import { History, Pencil, Plus, Power, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MonthPicker } from '@/components/MonthPicker';
import { CategoriaSelect } from '@/components/CategoriaSelect';
import { api } from '@/lib/api';
import { brl, hojeMes, mesBR, mesDe, parseValor } from '@/lib/format';
import { useDados } from '@/lib/dados';
import { useDialogs } from '@/lib/dialogs';
import { cn } from '@/lib/utils';
import { Metas } from '@/features/Metas';

const ehReceita = (p) => p.direcao === 'entrada' && p.recorrente;

function situacao(p, ref) {
  const ini = mesDe(p.inicio);
  const fim = p.fim ? mesDe(p.fim) : null;
  if (ini > ref) return 'futuro';
  if (fim && fim < ref) return 'historico';
  return 'vigente';
}

const SELO = {
  vigente: <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Vigente</Badge>,
  historico: <Badge variant="outline" className="gap-1 text-muted-foreground"><History className="size-3" />Histórico</Badge>,
  futuro: <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-300">Futuro</Badge>,
};

function Campo({ label, children, className }) {
  return <div className={cn('grid gap-1.5', className)}><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}

export function Planejamento() {
  return (
    <div className="grid gap-4">
      <Receitas />
      <Metas />
      <OutrosItens />
    </div>
  );
}

function Receitas() {
  const { planejamento, mes, recarregar } = useDados();
  const dialogs = useDialogs();
  const atual = hojeMes();
  const vazio = { id: null, responsavel: '', descricao: 'Salário', valor: '', inicio: atual, a_partir_de: '' };
  const [form, setForm] = useState(vazio);
  const receitas = useMemo(() => planejamento.filter(ehReceita)
    .sort((a, b) => `${a.responsavel}|${a.descricao}`.localeCompare(`${b.responsavel}|${b.descricao}`) || String(b.inicio).localeCompare(String(a.inicio))), [planejamento]);
  const ativasMes = receitas.filter((r) => situacao(r, mes) === 'vigente');
  const pessoas = [...new Set(receitas.map((r) => r.responsavel).filter(Boolean))];
  const substituida = (r) => receitas.some((o) => o.id !== r.id && o.responsavel === r.responsavel && o.descricao === r.descricao && String(o.inicio) > String(r.inicio));
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));

  const salvar = async (e) => {
    e.preventDefault();
    const valor = parseValor(form.valor);
    if (!(valor > 0)) return toast.error('Informe o valor');
    try {
      if (form.id) {
        const body = { responsavel: form.responsavel, descricao: form.descricao, valor };
        if (form.a_partir_de) body.a_partir_de = form.a_partir_de;
        await api(`/api/planejamento?id=${form.id}`, { method: 'PATCH', body });
      } else {
        await api('/api/planejamento', { method: 'POST', body: { responsavel: form.responsavel, descricao: form.descricao, valor, inicio: form.inicio, direcao: 'entrada', recorrente: true, categoria: 'Renda' } });
      }
      setForm(vazio);
      toast.success('Receita salva');
      recarregar();
    } catch (err) { toast.error(err.message); }
  };

  const encerrar = async (r) => {
    let ultimo = atual;
    const ok = await dialogs.confirm({
      title: 'Encerrar receita',
      description: `${r.descricao} de ${r.responsavel || '—'} deixa de entrar depois do mês escolhido.`,
      confirmText: 'Encerrar',
      children: <Campo label="Último mês em que entra"><EncerrarPicker inicial={atual} onChange={(m) => (ultimo = m)} /></Campo>,
    });
    if (!ok) return;
    try { await api(`/api/planejamento?id=${r.id}`, { method: 'PATCH', body: { fim: ultimo } }); toast.success('Receita encerrada'); recarregar(); }
    catch (err) { toast.error(err.message); }
  };
  const reativar = async (r) => {
    try { await api(`/api/planejamento?id=${r.id}`, { method: 'PATCH', body: { fim: null } }); toast.success('Receita reativada'); recarregar(); }
    catch (err) { toast.error(err.message); }
  };
  const excluir = async (r) => {
    if (!(await dialogs.confirm({ title: 'Excluir receita?', description: 'Some também dos meses passados. Para demissão, prefira "Encerrar".', confirmText: 'Excluir', destructive: true }))) return;
    try { await api(`/api/planejamento?id=${r.id}`, { method: 'DELETE' }); toast.success('Receita excluída'); recarregar(); }
    catch (err) { toast.error(err.message); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Receitas fixas (salários)</CardTitle>
        <CardDescription>
          {ativasMes.length ? <>Em {mesBR(mes)} entram <b className="text-foreground">{brl(ativasMes.reduce((a, r) => a + r.valor, 0))}</b>: {ativasMes.map((r) => `${r.responsavel || r.descricao} ${brl(r.valor)}`).join(' + ')}.</> : 'Nenhuma receita fixa neste mês.'}
          {' '}Ao mudar um valor, o antigo vira <b>Histórico</b> (continua contando só nos meses em que valeu) e o novo fica <b>Vigente</b>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form onSubmit={salvar} className="grid grid-cols-2 items-end gap-3 rounded-lg border bg-muted/30 p-3 md:grid-cols-6">
          <Campo label="Quem recebe" className="col-span-1">
            <Input className="h-9" list="pessoas" required value={form.responsavel} onChange={set('responsavel')} placeholder="Ex.: Marcão" />
            <datalist id="pessoas">{pessoas.map((p) => <option key={p} value={p} />)}</datalist>
          </Campo>
          <Campo label="Descrição"><Input className="h-9" required value={form.descricao} onChange={set('descricao')} /></Campo>
          <Campo label="Valor líquido (R$)"><Input className="h-9" inputMode="decimal" required value={form.valor} onChange={set('valor')} placeholder="0,00" /></Campo>
          {form.id
            ? <Campo label="Novo valor vale a partir de"><MonthPicker value={form.a_partir_de} onChange={set('a_partir_de')} clearable placeholder="Corrigir o atual" /></Campo>
            : <Campo label="Recebe desde"><MonthPicker value={form.inicio} onChange={set('inicio')} /></Campo>}
          <div className="col-span-2 flex gap-2">
            <Button type="submit" className="h-9 flex-1">{form.id ? 'Salvar alteração' : <><Plus /> Adicionar</>}</Button>
            {form.id && <Button type="button" variant="outline" className="h-9" onClick={() => setForm(vazio)}>Cancelar</Button>}
          </div>
        </form>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quem</TableHead>
                <TableHead className="hidden sm:table-cell">Situação</TableHead>
                <TableHead className="hidden sm:table-cell">Descrição</TableHead>
                <TableHead className="hidden sm:table-cell">Período</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {receitas.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">Cadastre os salários</TableCell></TableRow>}
              {receitas.map((r) => {
                const s = situacao(r, atual);
                return (
                  <TableRow key={r.id} className={cn(s === 'historico' && 'text-muted-foreground')}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">{r.responsavel || '—'}<span className="sm:hidden">{SELO[s]}</span></div>
                      <div className="text-xs font-normal text-muted-foreground sm:hidden">{mesBR(mesDe(r.inicio))} → {r.fim ? mesBR(mesDe(r.fim)) : 'atual'}</div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{SELO[s]}</TableCell>
                    <TableCell className="hidden sm:table-cell">{r.descricao}</TableCell>
                    <TableCell className="hidden whitespace-nowrap sm:table-cell">{mesBR(mesDe(r.inicio))} → {r.fim ? mesBR(mesDe(r.fim)) : 'atual'}</TableCell>
                    <TableCell className={cn('text-right font-medium tabular-nums', s !== 'historico' && 'text-emerald-600 dark:text-emerald-400')}>{brl(r.valor)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon-sm" title="Editar" onClick={() => setForm({ id: r.id, responsavel: r.responsavel || '', descricao: r.descricao, valor: String(r.valor).replace('.', ','), inicio: mesDe(r.inicio), a_partir_de: atual > mesDe(r.inicio) ? atual : '' })}><Pencil /></Button>
                        {r.fim
                          ? !substituida(r) && <Button variant="ghost" size="icon-sm" title="Reativar" onClick={() => reativar(r)}><RotateCcw /></Button>
                          : <Button variant="ghost" size="icon-sm" title="Encerrar (demissão)" onClick={() => encerrar(r)}><Power /></Button>}
                        <Button variant="ghost" size="icon-sm" title="Excluir" onClick={() => excluir(r)}><Trash2 className="text-muted-foreground" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function EncerrarPicker({ inicial, onChange }) {
  const [v, setV] = useState(inicial);
  return <MonthPicker value={v} onChange={(m) => { setV(m); onChange(m); }} />;
}

function OutrosItens() {
  const { planejamento, categorias, mes, recarregar } = useDados();
  const dialogs = useDialogs();
  const vazio = { descricao: '', direcao: 'saida', valor: '', categoria: 'Moradia', recorrente: 'true', inicio: mes, fim: '' };
  const [form, setForm] = useState(vazio);
  const [filtro, setFiltro] = useState('vigentes');
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));
  const itens = planejamento.filter((p) => !ehReceita(p))
    .filter((p) => filtro === 'todos' || (filtro === 'mes' ? situacao(p, mes) === 'vigente' && (p.recorrente || mesDe(p.inicio) === mes) : p.recorrente ? situacao(p, hojeMes()) !== 'historico' : mesDe(p.inicio) >= hojeMes()))
    .sort((a, b) => Number(b.recorrente) - Number(a.recorrente) || String(b.inicio).localeCompare(String(a.inicio)));

  const salvar = async (e) => {
    e.preventDefault();
    const valor = parseValor(form.valor);
    if (!(valor > 0)) return toast.error('Informe o valor');
    const body = { ...form, valor, recorrente: form.recorrente === 'true' };
    if (!body.fim) delete body.fim;
    try { await api('/api/planejamento', { method: 'POST', body }); setForm(vazio); toast.success('Adicionado'); recarregar(); }
    catch (err) { toast.error(err.message); }
  };
  const excluir = async (p) => {
    if (!(await dialogs.confirm({ title: 'Excluir item?', description: `${p.descricao} · ${brl(p.valor)}`, confirmText: 'Excluir', destructive: true }))) return;
    try { await api(`/api/planejamento?id=${p.id}`, { method: 'DELETE' }); toast.success('Excluído'); recarregar(); }
    catch (err) { toast.error(err.message); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Gastos fixos, custos pontuais e entradas avulsas</CardTitle>
        <CardDescription>Contas de todo mês (aluguel, condomínio, luz…), custos da mudança e entradas extras. Entram no resumo e na projeção.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form onSubmit={salvar} className="grid grid-cols-2 items-end gap-3 rounded-lg border bg-muted/30 p-3 md:grid-cols-4 xl:grid-cols-8">
          <Campo label="Descrição" className="col-span-2"><Input className="h-9" required value={form.descricao} onChange={set('descricao')} placeholder="Ex.: Condomínio" /></Campo>
          <Campo label="Tipo">
            <Select value={form.direcao} onValueChange={set('direcao')}>
              <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="saida">Saída</SelectItem><SelectItem value="entrada">Entrada</SelectItem></SelectContent>
            </Select>
          </Campo>
          <Campo label="Valor (R$)"><Input className="h-9" inputMode="decimal" required value={form.valor} onChange={set('valor')} placeholder="0,00" /></Campo>
          <Campo label="Categoria"><CategoriaSelect value={form.categoria} categorias={categorias} permitirNova={false} onChange={set('categoria')} className="h-9 max-w-none" /></Campo>
          <Campo label="Frequência">
            <Select value={form.recorrente} onValueChange={set('recorrente')}>
              <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="true">Mensal</SelectItem><SelectItem value="false">Única</SelectItem></SelectContent>
            </Select>
          </Campo>
          <Campo label={form.recorrente === 'true' ? 'Início' : 'Mês'}><MonthPicker value={form.inicio} onChange={set('inicio')} /></Campo>
          {form.recorrente === 'true' && <Campo label="Fim (opcional)"><MonthPicker value={form.fim} onChange={set('fim')} clearable placeholder="Sem fim" /></Campo>}
          <Button type="submit" className="col-span-2 h-9 md:col-span-1"><Plus /> Adicionar</Button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {[['vigentes', 'Atuais e futuros'], ['mes', `Só ${mesBR(mes)}`], ['todos', 'Todos (com histórico)']].map(([k, l]) => (
            <Button key={k} size="sm" variant={filtro === k ? 'default' : 'outline'} onClick={() => setFiltro(k)}>{l}</Button>
          ))}
        </div>
        <div className="max-h-[32rem] overflow-auto rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead className="hidden md:table-cell">Categoria</TableHead>
                <TableHead className="hidden sm:table-cell">Quando</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {itens.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">Nada por aqui</TableCell></TableRow>}
              {itens.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="max-w-56">
                    <div className="truncate font-medium">{p.descricao}</div>
                    <div className="text-xs text-muted-foreground">{p.recorrente ? 'Mensal' : 'Única'}{p.responsavel ? ` · ${p.responsavel}` : ''}</div>
                    <div className="text-xs text-muted-foreground sm:hidden">{p.recorrente ? `${mesBR(mesDe(p.inicio))} → ${p.fim ? mesBR(mesDe(p.fim)) : 'sem fim'}` : mesBR(mesDe(p.inicio))}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell"><Badge variant="secondary">{p.categoria}</Badge></TableCell>
                  <TableCell className="hidden whitespace-nowrap text-sm sm:table-cell">{p.recorrente ? `${mesBR(mesDe(p.inicio))} → ${p.fim ? mesBR(mesDe(p.fim)) : 'sem fim'}` : mesBR(mesDe(p.inicio))}</TableCell>
                  <TableCell className={cn('text-right font-medium tabular-nums whitespace-nowrap', p.direcao === 'entrada' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                    {p.direcao === 'entrada' ? '+' : '−'} {brl(p.valor)}
                  </TableCell>
                  <TableCell><Button variant="ghost" size="icon-sm" onClick={() => excluir(p)} aria-label="Excluir"><Trash2 className="text-muted-foreground" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
