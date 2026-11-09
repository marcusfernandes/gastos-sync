import { useMemo, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CategoriaSelect } from '@/components/CategoriaSelect';
import { api } from '@/lib/api';
import { addMeses, brl, dataBR, mesBR, mesDe } from '@/lib/format';
import { useDados, useMudarCategoria } from '@/lib/dados';
import { useDialogs } from '@/lib/dialogs';
import { cn } from '@/lib/utils';
import { CASAL, PessoaSelect, usePessoas } from '@/features/Pessoas';

const TIPOS = { compra: 'Compra', pix_enviado: 'Pix enviado', pix_recebido: 'Pix recebido', debito: 'Débito', fatura: 'Fatura', outro: 'Outro' };

function Pagamento({ t }) {
  if (t.tipo !== 'compra') return null;
  if (!(t.parcelas_total > 1)) return <span className="text-xs text-muted-foreground">à vista</span>;
  const fim = t.vencimento ? addMeses(mesDe(t.vencimento), t.parcelas_total - t.parcela_atual) : null;
  return (
    <div className="text-xs">
      <span className="font-medium tabular-nums">{t.parcela_atual}/{t.parcelas_total}</span>
      {fim && <div className="text-muted-foreground">até {mesBR(fim)}</div>}
    </div>
  );
}

export function Transacoes() {
  const { transacoes, categorias, mes, recarregar } = useDados();
  const mudar = useMudarCategoria();
  const dialogs = useDialogs();
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('todos');
  const [cat, setCat] = useState('todas');
  const [quem, setQuem] = useState('todos');
  const pessoas = usePessoas();

  const lista = useMemo(() => transacoes.filter((t) =>
    (tipo === 'todos' || t.tipo === tipo)
    && (cat === 'todas' || t.categoria === cat)
    && (quem === 'todos' || (t.responsavel || CASAL) === quem)
    && (!busca || `${t.estabelecimento} ${t.conta_ou_cartao} ${t.origem_assunto || ''}`.toLowerCase().includes(busca.toLowerCase())),
  ), [transacoes, busca, tipo, cat, quem]);
  const total = lista.filter((t) => !['pix_recebido', 'fatura'].includes(t.tipo)).reduce((a, t) => a + t.valor, 0);

  const excluir = async (t) => {
    if (!(await dialogs.confirm({ title: 'Excluir transação?', description: `${t.estabelecimento} · ${brl(t.valor)}`, confirmText: 'Excluir', destructive: true }))) return;
    try { await api(`/api/transacoes?id=${t.id}`, { method: 'DELETE' }); toast.success('Transação excluída'); recarregar(); }
    catch (e) { toast.error(e.message); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Transações de {mesBR(mes)}</CardTitle>
        <CardDescription>{lista.length} lançamento(s) · {brl(total)} em gastos (sem faturas e Pix recebidos)</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-9 pl-8" placeholder="Buscar estabelecimento, cartão…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger className="h-9 w-full sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os tipos</SelectItem>
              {Object.entries(TIPOS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="h-9 w-full sm:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as categorias</SelectItem>
              {categorias.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={quem} onValueChange={setQuem}>
            <SelectTrigger className="h-9 w-full sm:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as pessoas</SelectItem>
              {[...pessoas, CASAL].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="max-h-[36rem] overflow-auto rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="hidden sm:table-cell">Data</TableHead>
                <TableHead>Estabelecimento</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="hidden lg:table-cell">Tipo</TableHead>
                <TableHead className="hidden md:table-cell">Pagamento</TableHead>
                <TableHead className="hidden sm:table-cell">De quem</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.length === 0 && (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Nenhuma transação encontrada</TableCell></TableRow>
              )}
              {lista.map((t) => (
                <TableRow key={t.id ?? t.dedupe_key}>
                  <TableCell className="hidden whitespace-nowrap tabular-nums sm:table-cell">{dataBR(t.data)}</TableCell>
                  <TableCell className="max-w-40 sm:max-w-64">
                    <div className="truncate font-medium" title={t.estabelecimento}>{t.estabelecimento}</div>
                    <div className="truncate text-xs text-muted-foreground" title={t.origem_assunto || ''}>
                      <span className="sm:hidden">{dataBR(t.data)} · </span>{t.conta_ou_cartao}{t.origem_assunto ? ` · ${t.origem_assunto}` : ''}
                    </div>
                  </TableCell>
                  <TableCell>
                    {t.id ? (
                      <CategoriaSelect value={t.categoria} categorias={categorias} onChange={(c) => mudar({ id: t.id, estabelecimento: t.estabelecimento, categoria: c })} />
                    ) : <Badge variant="secondary">{t.categoria}</Badge>}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell"><Badge variant="outline">{TIPOS[t.tipo] || t.tipo}</Badge></TableCell>
                  <TableCell className="hidden md:table-cell"><Pagamento t={t} /></TableCell>
                  <TableCell className="hidden sm:table-cell">{t.id && <PessoaSelect t={t} onSalvo={recarregar} />}</TableCell>
                  <TableCell className={cn('text-right font-medium whitespace-nowrap tabular-nums', t.tipo === 'pix_recebido' && 'text-emerald-600 dark:text-emerald-400')}>{brl(t.valor)}</TableCell>
                  <TableCell>
                    {t.id && <Button variant="ghost" size="icon-sm" onClick={() => excluir(t)} aria-label="Excluir"><Trash2 className="text-muted-foreground" /></Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
