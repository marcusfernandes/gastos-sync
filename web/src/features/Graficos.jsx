import { useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { formatarBRL } from '@/components/tooltip';
import { api } from '@/lib/api';
import { brl, eixoBRL, mesBR, mesBRCurto, pct } from '@/lib/format';
import { useDados } from '@/lib/dados';
import { cn } from '@/lib/utils';

const PALETA = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'oklch(0.65 0.12 320)', 'oklch(0.6 0.02 270)'];

function Opcoes({ valor, onChange, opcoes }) {
  return (
    <div className="flex rounded-lg border p-0.5">
      {opcoes.map(([v, l]) => (
        <Button key={v} size="xs" variant={valor === v ? 'default' : 'ghost'} onClick={() => onChange(v)}>{l}</Button>
      ))}
    </div>
  );
}

function Grafico({ titulo, descricao, acao, children, className }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">{titulo}</CardTitle>
        {descricao && <CardDescription>{descricao}</CardDescription>}
        {acao && <CardAction>{acao}</CardAction>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

const eixoY = { tickLine: false, axisLine: false, width: 56, tickFormatter: eixoBRL };

export function Graficos() {
  const { mes, versao } = useDados();
  const [periodo, setPeriodo] = useState(12);
  const [horizonte, setHorizonte] = useState(12);
  const [serie, setSerie] = useState(null);
  const [proj, setProj] = useState(null);

  useEffect(() => {
    api(`/api/historico?ate=${mes}&meses=${periodo}`).then(setSerie).catch((e) => toast.error(e.message));
  }, [mes, periodo, versao]);
  useEffect(() => {
    api(`/api/relatorio?mes=${mes}&meses=${horizonte}`).then((r) => setProj(r.projecao)).catch((e) => toast.error(e.message));
  }, [mes, horizonte, versao]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <EntradasSaidas serie={serie} periodo={periodo} setPeriodo={setPeriodo} />
      <PorCategoria serie={serie} />
      <Variacao serie={serie} mes={mes} />
      <Composicao serie={serie} mes={mes} />
      <SaldoProjetado proj={proj} horizonte={horizonte} setHorizonte={setHorizonte} />
      <SaidasProjetadas proj={proj} />
      <Parcelas proj={proj} />
    </div>
  );
}

const esConfig = {
  entradas: { label: 'Entradas', color: 'var(--chart-2)' },
  saidas: { label: 'Saídas', color: 'var(--chart-4)' },
  resultado: { label: 'Resultado', color: 'var(--chart-1)' },
};

function EntradasSaidas({ serie, periodo, setPeriodo }) {
  const dados = serie?.map((s) => ({ ...s, mesL: mesBRCurto(s.mes) }));
  const comDados = serie?.filter((s) => s.entradas || s.saidas) || [];
  const media = comDados.length ? comDados.reduce((a, s) => a + s.resultado, 0) / comDados.length : 0;
  return (
    <Grafico
      className="lg:col-span-2"
      titulo="Entradas × saídas por mês"
      descricao={serie ? `Resultado médio: ${brl(media)}/mês` : ' '}
      acao={<Opcoes valor={periodo} onChange={setPeriodo} opcoes={[[6, '6m'], [12, '12m'], [24, '24m']]} />}
    >
      {!dados ? <Skeleton className="h-72" /> : (
        <ChartContainer config={esConfig} className="aspect-auto h-72 w-full">
          <ComposedChart data={dados} margin={{ left: 4, right: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="mesL" tickLine={false} axisLine={false} />
            <YAxis {...eixoY} />
            <ReferenceLine y={0} stroke="var(--border)" />
            <ChartTooltip content={<ChartTooltipContent formatter={formatarBRL(esConfig)} />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="entradas" fill="var(--color-entradas)" radius={4} />
            <Bar dataKey="saidas" fill="var(--color-saidas)" radius={4} />
            <Line dataKey="resultado" type="monotone" stroke="var(--color-resultado)" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ChartContainer>
      )}
    </Grafico>
  );
}

function topCategorias(serie, n = 6) {
  const tot = {};
  for (const s of serie) for (const [c, v] of Object.entries(s.categorias)) tot[c] = (tot[c] || 0) + v;
  return Object.entries(tot).sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, n);
}
const chave = (c) => `c_${c.normalize('NFD').replace(/[^\w]/g, '')}`;

function PorCategoria({ serie }) {
  const [modo, setModo] = useState('valor');
  const { dados, config } = useMemo(() => {
    if (!serie) return {};
    const top = topCategorias(serie);
    const config = Object.fromEntries([...top, 'Demais'].map((c, i) => [chave(c), { label: c, color: PALETA[i % PALETA.length] }]));
    const dados = serie.map((s) => {
      const row = { mesL: mesBRCurto(s.mes) };
      let demais = 0;
      for (const [c, v] of Object.entries(s.categorias)) {
        if (top.includes(c)) row[chave(c)] = v; else demais += v;
      }
      row[chave('Demais')] = Math.round(demais * 100) / 100;
      return row;
    });
    return { dados, config };
  }, [serie]);
  return (
    <Grafico
      titulo="Saídas por categoria"
      descricao="As 6 maiores categorias do período, mês a mês"
      acao={<Opcoes valor={modo} onChange={setModo} opcoes={[['valor', 'R$'], ['pct', '%']]} />}
    >
      {!dados ? <Skeleton className="h-72" /> : (
        <ChartContainer config={config} className="aspect-auto h-72 w-full">
          <BarChart data={dados} stackOffset={modo === 'pct' ? 'expand' : 'none'} margin={{ left: 4, right: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="mesL" tickLine={false} axisLine={false} />
            <YAxis {...eixoY} tickFormatter={modo === 'pct' ? (v) => `${Math.round(v * 100)}%` : eixoBRL} />
            <ChartTooltip content={<ChartTooltipContent formatter={formatarBRL(config)} />} />
            <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
            {Object.keys(config).map((k) => <Bar key={k} dataKey={k} stackId="a" fill={`var(--color-${k})`} />)}
          </BarChart>
        </ChartContainer>
      )}
    </Grafico>
  );
}

function Delta({ v }) {
  if (v === null || !Number.isFinite(v)) return <span className="text-muted-foreground">—</span>;
  const Icone = Math.abs(v) < 0.02 ? Minus : v > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-0.5 tabular-nums', v > 0.02 ? 'text-rose-600 dark:text-rose-400' : v < -0.02 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
      <Icone className="size-3.5" />{pct(v)}
    </span>
  );
}

function Variacao({ serie, mes }) {
  const linhas = useMemo(() => {
    if (!serie) return null;
    const i = serie.findIndex((s) => s.mes === mes);
    if (i < 0) return [];
    const atual = serie[i].categorias;
    const ant = serie[i - 1]?.categorias || {};
    const ult3 = serie.slice(Math.max(0, i - 3), i);
    const cats = [...new Set([...Object.keys(atual), ...Object.keys(ant)])];
    return cats.map((c) => {
      const v = atual[c] || 0;
      const a = ant[c] || 0;
      const media = ult3.length ? ult3.reduce((s, m) => s + (m.categorias[c] || 0), 0) / ult3.length : 0;
      return { c, v, a, dAnt: a ? (v - a) / a : null, media, dMedia: media ? (v - media) / media : null };
    }).sort((x, y) => y.v - x.v);
  }, [serie, mes]);
  return (
    <Grafico titulo={`Variação por categoria em ${mesBR(mes)}`} descricao="Comparado ao mês anterior e à média dos 3 meses anteriores">
      {!linhas ? <Skeleton className="h-72" /> : (
        <div className="max-h-80 overflow-auto rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">No mês</TableHead>
                <TableHead className="text-right">vs anterior</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Média 3m</TableHead>
                <TableHead className="text-right">vs média</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">Sem dados</TableCell></TableRow>}
              {linhas.map((l) => (
                <TableRow key={l.c}>
                  <TableCell className="font-medium">{l.c}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(l.v)}</TableCell>
                  <TableCell className="text-right"><Delta v={l.dAnt} /></TableCell>
                  <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{brl(l.media)}</TableCell>
                  <TableCell className="text-right"><Delta v={l.dMedia} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Grafico>
  );
}

function Composicao({ serie, mes }) {
  const s = serie?.find((x) => x.mes === mes);
  const itens = s ? Object.entries(s.categorias).sort((a, b) => b[1] - a[1]) : [];
  const top = itens.slice(0, 6);
  const resto = itens.slice(6).reduce((a, [, v]) => a + v, 0);
  if (resto) top.push(['Demais', resto]);
  const dados = top.map(([c, v], i) => ({ nome: c, valor: v, fill: PALETA[i % PALETA.length] }));
  const config = Object.fromEntries(dados.map((d) => [d.nome, { label: d.nome, color: d.fill }]));
  const total = itens.reduce((a, [, v]) => a + v, 0);
  return (
    <Grafico titulo={`Para onde foi o dinheiro em ${mesBR(mes)}`} descricao={s ? `${brl(total)} em saídas` : ' '}>
      {!serie ? <Skeleton className="h-72" /> : !dados.length ? <p className="py-10 text-center text-sm text-muted-foreground">Sem saídas neste mês</p> : (
        <div className="grid items-center gap-4 sm:grid-cols-2">
          <ChartContainer config={config} className="mx-auto aspect-square h-56">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="nome" formatter={formatarBRL(config)} />} />
              <Pie data={dados} dataKey="valor" nameKey="nome" innerRadius="55%" strokeWidth={2}>
                {dados.map((d) => <Cell key={d.nome} fill={d.fill} />)}
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="grid gap-1.5 text-sm">
            {dados.map((d) => (
              <div key={d.nome} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2"><span className="size-2.5 shrink-0 rounded-sm" style={{ background: d.fill }} /><span className="truncate">{d.nome}</span></span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{Math.round((d.valor / total) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Grafico>
  );
}

const saldoConfig = { saldo: { label: 'Saldo projetado', color: 'var(--chart-1)' } };

function SaldoProjetado({ proj, horizonte, setHorizonte }) {
  const dados = proj?.meses.map((m) => ({ mesL: mesBRCurto(m.mes), saldo: m.saldo_projetado }));
  const ultimo = proj?.meses.at(-1);
  return (
    <Grafico
      titulo="Evolução do saldo projetado"
      descricao={proj ? `De ${brl(proj.saldo_inicial)} para ${brl(ultimo?.saldo_projetado)} em ${mesBR(ultimo?.mes)}` : ' '}
      acao={<Opcoes valor={horizonte} onChange={setHorizonte} opcoes={[[6, '6m'], [12, '12m'], [24, '24m']]} />}
    >
      {!dados ? <Skeleton className="h-64" /> : (
        <ChartContainer config={saldoConfig} className="aspect-auto h-64 w-full">
          <AreaChart data={dados} margin={{ left: 4, right: 8 }}>
            <defs>
              <linearGradient id="gSaldo" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-saldo)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--color-saldo)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="mesL" tickLine={false} axisLine={false} />
            <YAxis {...eixoY} />
            <ReferenceLine y={0} stroke="var(--destructive)" strokeDasharray="4 4" />
            <ChartTooltip content={<ChartTooltipContent formatter={formatarBRL(saldoConfig)} />} />
            <Area dataKey="saldo" type="monotone" stroke="var(--color-saldo)" fill="url(#gSaldo)" strokeWidth={2} />
          </AreaChart>
        </ChartContainer>
      )}
    </Grafico>
  );
}

const saidasConfig = {
  gastos_fixos: { label: 'Fixos', color: 'var(--chart-3)' },
  gastos_variaveis_estimados: { label: 'Variáveis (est.)', color: 'var(--chart-5)' },
  parcelas: { label: 'Parcelas', color: 'var(--chart-1)' },
  gastos_pontuais: { label: 'Pontuais', color: 'var(--chart-4)' },
  reservas: { label: 'Guardar (metas)', color: 'var(--chart-2)' },
};

function SaidasProjetadas({ proj }) {
  const dados = proj?.meses.map((m) => ({ ...m, mesL: mesBRCurto(m.mes) }));
  return (
    <Grafico titulo="Composição das saídas futuras" descricao="O que pesa em cada mês da projeção">
      {!dados ? <Skeleton className="h-64" /> : (
        <ChartContainer config={saidasConfig} className="aspect-auto h-64 w-full">
          <BarChart data={dados} margin={{ left: 4, right: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="mesL" tickLine={false} axisLine={false} />
            <YAxis {...eixoY} />
            <ChartTooltip content={<ChartTooltipContent formatter={formatarBRL(saidasConfig)} />} />
            <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
            {Object.keys(saidasConfig).map((k) => <Bar key={k} dataKey={k} stackId="s" fill={`var(--color-${k})`} />)}
          </BarChart>
        </ChartContainer>
      )}
    </Grafico>
  );
}

const parcConfig = { parcelas: { label: 'Parcelas no mês', color: 'var(--chart-1)' } };

function Parcelas({ proj }) {
  const dados = proj?.meses.map((m) => ({
    mesL: mesBRCurto(m.mes),
    parcelas: m.parcelas,
    ativas: proj.parcelamentos.filter((p) => p.mes_cobranca <= m.mes && m.mes <= p.mes_fim).length,
    terminam: proj.parcelamentos.filter((p) => p.mes_fim === m.mes).map((p) => p.estabelecimento),
  }));
  const proximas = proj?.parcelamentos.slice(0, 4) || [];
  return (
    <Grafico className="lg:col-span-2" titulo="Parcelas caindo ao longo do tempo" descricao="Quanto das parcelas já conhecidas pesa em cada mês, e quando cada uma termina">
      {!dados ? <Skeleton className="h-64" /> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <ChartContainer config={parcConfig} className="aspect-auto h-64 w-full lg:col-span-2">
            <AreaChart data={dados} margin={{ left: 4, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="mesL" tickLine={false} axisLine={false} />
              <YAxis {...eixoY} />
              <ChartTooltip content={<ChartTooltipContent formatter={(v, n, item) => (
                <div className="grid gap-0.5">
                  <span className="font-mono font-medium">{brl(v)}</span>
                  <span className="text-muted-foreground">{item.payload.ativas} parcelamento(s) ativos</span>
                  {item.payload.terminam.length > 0 && <span className="text-emerald-600 dark:text-emerald-400">Termina: {item.payload.terminam.join(', ')}</span>}
                </div>
              )} />} />
              <Area dataKey="parcelas" type="stepAfter" stroke="var(--color-parcelas)" fill="var(--color-parcelas)" fillOpacity={0.2} strokeWidth={2} />
            </AreaChart>
          </ChartContainer>
          <div className="grid content-start gap-2">
            <span className="text-xs font-medium text-muted-foreground">Próximas a terminar</span>
            {proximas.length === 0 && <span className="text-sm text-muted-foreground">Nenhuma parcela em aberto</span>}
            {proximas.map((p) => (
              <div key={`${p.id}-${p.estabelecimento}`} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.estabelecimento}</div>
                  <div className="text-xs text-muted-foreground">{p.parcela_atual}/{p.parcelas_total} · última em {mesBR(p.mes_fim)}</div>
                </div>
                <span className="shrink-0 tabular-nums">{brl(p.valor_parcela)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Grafico>
  );
}
