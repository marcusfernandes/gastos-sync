import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, CalendarClock, CreditCard, PiggyBank, Receipt, Wallet } from 'lucide-react';
import { Area, CartesianGrid, ComposedChart, Bar, ReferenceLine, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Kpi } from '@/components/Kpi';
import { formatarBRL } from '@/components/tooltip';
import { CategoriaSelect } from '@/components/CategoriaSelect';
import { SaldoAtual } from '@/features/SaldoAtual';
import { ContasMes } from '@/features/ContasMes';
import { brl, eixoBRL, mesBR, mesBRCurto } from '@/lib/format';
import { useDados, useMudarCategoria } from '@/lib/dados';
import { cn } from '@/lib/utils';

const corValor = (v) => (v < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400');

export function Visao() {
  const { relatorio, mes, carregando } = useDados();
  if (!relatorio) return <Carregando />;
  const { resumo: r, projecao: p } = relatorio;
  const saidasMes = Math.max(r.gastos.registrados, r.gastos.fixos_planejados + r.gastos.pontuais_planejados) + (r.gastos.faturas_sem_detalhe || 0);

  return (
    <div className={cn('grid gap-4 transition-opacity', carregando && 'opacity-60')}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi titulo="Entradas" valor={brl(r.entradas.cadastradas)} icone={ArrowUpCircle} tom="verde" detalhe={r.entradas.recebidas_pix ? `+ ${brl(r.entradas.recebidas_pix)} em Pix` : 'salários e entradas'} />
        <Kpi titulo="Gastos registrados" valor={brl(r.gastos.registrados)} icone={ArrowDownCircle} tom="vermelho" detalhe="Pix, débitos e compras (cartão no mês da fatura)" />
        <Kpi titulo="Fixos planejados" valor={brl(r.gastos.fixos_planejados)} icone={CalendarClock} tom="ambar" detalhe={r.gastos.pontuais_planejados ? `+ ${brl(r.gastos.pontuais_planejados)} pontuais` : 'contas do mês'} />
        <Kpi titulo="Faturas sem detalhe" valor={brl(r.gastos.faturas_sem_detalhe || 0)} icone={CreditCard} tom="azul" detalhe="cartões sem compras lidas" />
        <Kpi titulo="Saídas do mês" valor={brl(saidasMes)} icone={Receipt} tom="vermelho" detalhe="o maior entre registrado e planejado" />
        <Kpi titulo="Saldo do mês" valor={<span className={corValor(r.saldo_estimado)}>{brl(r.saldo_estimado)}</span>} icone={Wallet} detalhe={mesBR(mes)} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-3">
          <ContasMes />
        </div>
        <div className="grid min-w-0 gap-4 lg:col-span-2">
          <SaldoAtual />
          <Categorias porCategoria={r.gastos.por_categoria} />
        </div>
      </div>

      <Projecao p={p} />
      <Parcelamentos p={p} />
    </div>
  );
}

function Carregando() {
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      <Skeleton className="h-64" />
      <Skeleton className="h-80" />
    </div>
  );
}

const CORES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

function Categorias({ porCategoria, className }) {
  const itens = Object.entries(porCategoria || {});
  const total = itens.reduce((a, [, v]) => a + v, 0);
  const max = itens[0]?.[1] || 1;
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><PiggyBank className="size-4 text-primary" /> Gastos por categoria</CardTitle>
        <CardDescription>{itens.length ? `${brl(total)} em gastos registrados no mês` : 'Sem gastos registrados neste mês'}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {itens.map(([cat, v], i) => (
          <div key={cat} className="grid gap-1">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{cat}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {brl(v)} <span className="text-xs">· {Math.round((v / total) * 100)}%</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: CORES[i % CORES.length] }} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const projConfig = {
  entradas: { label: 'Entradas', color: 'var(--chart-2)' },
  saidas: { label: 'Saídas', color: 'var(--chart-4)' },
  saldo: { label: 'Saldo projetado', color: 'var(--chart-1)' },
};

function Projecao({ p }) {
  const dados = p.meses.map((m) => ({
    mes: mesBRCurto(m.mes),
    entradas: m.entradas,
    saidas: m.gastos_fixos + m.gastos_variaveis_estimados + m.parcelas + m.gastos_pontuais,
    saldo: m.saldo_projetado,
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Projeção de saldo</CardTitle>
        <CardDescription>
          Parte de {brl(p.saldo_inicial)} · gastos variáveis estimados em {brl(p.media_variavel_mensal)}/mês (média dos últimos meses)
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {p.alerta && (
          <div className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
            <AlertTriangle className="size-4 shrink-0" /> Saldo fica negativo a partir de {mesBR(p.meses.find((m) => m.saldo_projetado < 0)?.mes)} e chega a {brl(p.menor_saldo.valor)} em {mesBR(p.menor_saldo.mes)}
          </div>
        )}
        <ChartContainer config={projConfig} className="aspect-auto h-64 w-full sm:h-72">
          <ComposedChart data={dados} margin={{ left: 4, right: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="mes" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={eixoBRL} />
            <ReferenceLine y={0} stroke="var(--border)" />
            <ChartTooltip content={<ChartTooltipContent formatter={formatarBRL(projConfig)} />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="entradas" fill="var(--color-entradas)" radius={4} />
            <Bar dataKey="saidas" fill="var(--color-saidas)" radius={4} />
            <Area dataKey="saldo" type="monotone" stroke="var(--color-saldo)" fill="var(--color-saldo)" fillOpacity={0.15} strokeWidth={2} />
          </ComposedChart>
        </ChartContainer>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mês</TableHead>
                <TableHead className="text-right">Entradas</TableHead>
                <TableHead className="text-right">Fixos</TableHead>
                <TableHead className="hidden text-right md:table-cell">Variáveis (est.)</TableHead>
                <TableHead className="hidden text-right md:table-cell">Parcelas</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Pontuais</TableHead>
                <TableHead className="text-right">Resultado</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.meses.map((m) => (
                <TableRow key={m.mes}>
                  <TableCell className="font-medium">{mesBR(m.mes)}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(m.entradas)}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(m.gastos_fixos)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">{brl(m.gastos_variaveis_estimados)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">{brl(m.parcelas)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums lg:table-cell" title={m.pontuais.map((x) => `${x.descricao}: ${brl(x.valor)}`).join('\n')}>{brl(m.gastos_pontuais)}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', corValor(m.resultado_mes))}>{brl(m.resultado_mes)}</TableCell>
                  <TableCell className={cn('text-right font-medium tabular-nums', corValor(m.saldo_projetado))}>{brl(m.saldo_projetado)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function Parcelamentos({ p }) {
  const { categorias } = useDados();
  const mudar = useMudarCategoria();
  const lista = p.parcelamentos;
  const mensal = lista.reduce((a, x) => a + x.valor_parcela, 0);
  const restante = lista.reduce((a, x) => a + x.restante, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Parcelamentos em aberto</CardTitle>
        <CardDescription>
          {lista.length ? `${lista.length} compras · ${brl(mensal)}/mês · ${brl(restante)} ainda a pagar` : 'Nenhum parcelamento em aberto'}
        </CardDescription>
      </CardHeader>
      {lista.length > 0 && (
        <CardContent>
          <div className="max-h-[28rem] overflow-auto rounded-lg border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Compra</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Parcela</TableHead>
                  <TableHead className="hidden sm:table-cell">Última</TableHead>
                  <TableHead className="text-right">Por mês</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Falta pagar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((x) => (
                  <TableRow key={`${x.id}-${x.estabelecimento}`}>
                    <TableCell className="max-w-48">
                      <div className="truncate font-medium" title={x.estabelecimento}>{x.estabelecimento}</div>
                      <div className="text-xs text-muted-foreground">{x.conta_ou_cartao}</div>
                    </TableCell>
                    <TableCell>
                      {x.id ? (
                        <CategoriaSelect
                          value={x.categoria}
                          categorias={categorias}
                          onChange={(c) => mudar({ id: x.id, estabelecimento: x.estabelecimento, categoria: c, parcelamento: true })}
                        />
                      ) : <Badge variant="secondary">{x.categoria}</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums">{x.parcela_atual}/{x.parcelas_total}</span>
                        <div className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-muted md:block">
                          <div className="h-full bg-primary" style={{ width: `${(x.parcela_atual / x.parcelas_total) * 100}%` }} />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{mesBR(x.mes_fim)}</TableCell>
                    <TableCell className="text-right tabular-nums">{brl(x.valor_parcela)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{brl(x.restante)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
