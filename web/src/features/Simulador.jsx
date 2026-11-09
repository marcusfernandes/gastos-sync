import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Save, TrendingDown, TriangleAlert } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { formatarBRL } from '@/components/tooltip';
import { CategoriaSelect } from '@/components/CategoriaSelect';
import { MonthPicker } from '@/components/MonthPicker';
import { Kpi } from '@/components/Kpi';
import { api } from '@/lib/api';
import { useDados } from '@/lib/dados';
import { useDialogs } from '@/lib/dialogs';
import { addMeses, brl, eixoBRL, mesBR, mesBRCurto, parseValor } from '@/lib/format';
import { melhorInicio, simular } from '@/lib/simulacao';
import { cn } from '@/lib/utils';

const HORIZONTE = 24;
const config = {
  antes: { label: 'Sem a compra', color: 'var(--chart-2)' },
  depois: { label: 'Com a compra', color: 'var(--chart-1)' },
};

function Campo({ label, children, className }) {
  return <div className={cn('grid gap-1.5', className)}><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}

export function Simulador() {
  const { mes, categorias, recarregar } = useDados();
  const dialogs = useDialogs();
  const [proj, setProj] = useState(null);
  const [descricao, setDescricao] = useState('');
  const [valorTxt, setValorTxt] = useState('');
  const [entradaTxt, setEntradaTxt] = useState('');
  const [parcelas, setParcelas] = useState('1');
  const [inicio, setInicio] = useState(() => addMeses(mes, 1));
  const [categoria, setCategoria] = useState('Compras');
  const [margemTxt, setMargemTxt] = useState('');

  useEffect(() => {
    api(`/api/relatorio?mes=${mes}&meses=${HORIZONTE}`).then((r) => setProj(r.projecao)).catch((e) => toast.error(e.message));
  }, [mes]);

  const valor = parseValor(valorTxt) || 0;
  const entrada = Math.min(parseValor(entradaTxt) || 0, valor);
  const n = Math.max(1, Math.min(72, Number.parseInt(parcelas, 10) || 1));
  const margem = parseValor(margemTxt) || 0;
  const compra = { valor, entrada, parcelas: n, inicio };
  const valida = valor > 0 && Boolean(inicio);
  const meses = useMemo(() => proj?.meses ?? [], [proj]);

  const sim = useMemo(() => (valida && meses.length ? simular(meses, compra) : null), [meses, valida, valor, entrada, n, inicio]); // eslint-disable-line react-hooks/exhaustive-deps
  const melhor = useMemo(() => (valida && meses.length ? melhorInicio(meses, compra, { margem }) : null), [meses, valida, valor, entrada, n, margem]); // eslint-disable-line react-hooks/exhaustive-deps
  const dadosGrafico = (sim?.linhas ?? meses.map((m) => ({ ...m, saldo_com: m.saldo_projetado }))).map((l) => ({ mesL: mesBRCurto(l.mes), antes: l.saldo_projetado, depois: l.saldo_com }));
  const parcela = (valor - entrada) / n;

  const salvar = async () => {
    if (!descricao.trim()) return toast.error('Dê um nome para a compra');
    const ok = await dialogs.confirm({
      title: 'Salvar no planejamento?',
      description: `Entra como gasto planejado de ${brl(parcela)}/mês de ${mesBR(inicio)} a ${mesBR(addMeses(inicio, n - 1))}${entrada ? ` + entrada de ${brl(entrada)}` : ''}. Se a compra for feita no cartão, apague o planejado quando ela aparecer na fatura, para não contar duas vezes.`,
      confirmText: 'Salvar',
    });
    if (!ok) return;
    try {
      const base = { direcao: 'saida', categoria, inicio };
      if (parcela > 0) await api('/api/planejamento', { method: 'POST', body: { ...base, descricao: n > 1 ? `${descricao.trim()} (${n}x)` : descricao.trim(), valor: Math.round(parcela * 100) / 100, recorrente: n > 1, ...(n > 1 && { fim: addMeses(inicio, n - 1) }) } });
      if (entrada > 0) await api('/api/planejamento', { method: 'POST', body: { ...base, descricao: `${descricao.trim()} (entrada)`, valor: entrada, recorrente: false } });
      toast.success('Compra adicionada em Receitas e fixos');
      recarregar();
      api(`/api/relatorio?mes=${mes}&meses=${HORIZONTE}`).then((r) => setProj(r.projecao));
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">E se eu comprar…</CardTitle>
          <CardDescription>Veja o efeito no saldo projetado antes de decidir. Nada é gravado até você salvar.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Campo label="O quê"><Input className="h-9" placeholder="Ex.: Sofá" value={descricao} onChange={(e) => setDescricao(e.target.value)} /></Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Valor total (R$)"><Input className="h-9" inputMode="decimal" placeholder="4.000,00" value={valorTxt} onChange={(e) => setValorTxt(e.target.value)} /></Campo>
            <Campo label="Entrada (R$)"><Input className="h-9" inputMode="decimal" placeholder="0,00" value={entradaTxt} onChange={(e) => setEntradaTxt(e.target.value)} /></Campo>
            <Campo label="Parcelas"><Input className="h-9" type="number" min={1} max={72} value={parcelas} onChange={(e) => setParcelas(e.target.value)} /></Campo>
            <Campo label="1ª parcela em"><MonthPicker value={inicio} onChange={setInicio} /></Campo>
          </div>
          <Campo label="Categoria"><CategoriaSelect value={categoria} categorias={categorias} onChange={setCategoria} permitirNova={false} className="max-w-none" /></Campo>
          <Campo label="Manter sempre pelo menos (R$)"><Input className="h-9" inputMode="decimal" placeholder="0,00" value={margemTxt} onChange={(e) => setMargemTxt(e.target.value)} /></Campo>
          {valida && <p className="text-sm text-muted-foreground">{n > 1 ? `${n}x de ${brl(parcela)}` : `À vista: ${brl(valor)}`}{entrada > 0 && ` + entrada de ${brl(entrada)}`}, até {mesBR(addMeses(inicio, n - 1))}.</p>}
          <Button disabled={!valida} onClick={salvar}><Save /> Salvar no planejamento</Button>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi titulo="Menor saldo sem a compra" valor={proj ? brl(sim?.menor_antes.valor ?? proj.menor_saldo?.valor) : '—'} detalhe={proj && mesBR(sim?.menor_antes.mes ?? proj.menor_saldo?.mes)} icone={TrendingDown} tom="azul" />
          <Kpi titulo="Menor saldo com a compra" valor={sim ? brl(sim.menor_depois.valor) : '—'} detalhe={sim ? (sim.primeiro_negativo ? `Fica negativo em ${mesBR(sim.primeiro_negativo)}` : mesBR(sim.menor_depois.mes)) : 'Preencha o valor'} icone={sim?.primeiro_negativo ? TriangleAlert : TrendingDown} tom={sim?.primeiro_negativo ? 'vermelho' : 'verde'} />
          <Kpi
            titulo="Melhor mês para começar"
            valor={melhor ? mesBR(melhor.inicio) : '—'}
            detalhe={melhor ? (melhor.menor >= margem ? `Saldo mínimo de ${brl(melhor.menor)}` : `Nenhum mês mantém ${brl(margem)}; o menos apertado`) : 'Nos próximos 12 meses'}
            icone={CalendarCheck}
            tom={melhor && melhor.menor >= margem ? 'verde' : 'ambar'}
          />
        </div>
        {melhor && melhor.inicio !== inicio && (
          <Button variant="outline" size="sm" className="w-fit" onClick={() => setInicio(melhor.inicio)}>Usar {mesBR(melhor.inicio)} como 1ª parcela</Button>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Saldo projetado</CardTitle>
            <CardDescription>Próximos {HORIZONTE} meses a partir de {mesBR(mes)}, considerando receitas, fixos, parcelas e média de gastos variáveis.</CardDescription>
          </CardHeader>
          <CardContent>
            {!proj ? <Skeleton className="h-72" /> : (
              <ChartContainer config={config} className="aspect-auto h-72 w-full">
                <LineChart data={dadosGrafico} margin={{ left: 4, right: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="mesL" tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={eixoBRL} tickLine={false} axisLine={false} width={56} />
                  <ReferenceLine y={0} stroke="var(--destructive)" strokeDasharray="4 4" />
                  {margem > 0 && <ReferenceLine y={margem} stroke="var(--chart-4)" strokeDasharray="2 4" />}
                  <ChartTooltip content={<ChartTooltipContent formatter={formatarBRL(config)} />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Line dataKey="antes" type="monotone" stroke="var(--color-antes)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                  <Line dataKey="depois" type="monotone" stroke="var(--color-depois)" strokeWidth={2} dot={false} />
                </LineChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
        {sim && (
          <Card>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Mês</TableHead><TableHead className="text-right">Custo da compra</TableHead><TableHead className="hidden text-right sm:table-cell">Resultado do mês</TableHead><TableHead className="text-right">Saldo</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {sim.linhas.filter((l) => l.custo > 0 || l.mes <= addMeses(inicio, n + 2)).map((l) => (
                    <TableRow key={l.mes}>
                      <TableCell>{mesBR(l.mes)}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.custo ? brl(l.custo) : '—'}</TableCell>
                      <TableCell className={cn('hidden text-right tabular-nums sm:table-cell', l.resultado_com < 0 && 'text-rose-600')}>{brl(l.resultado_com)}</TableCell>
                      <TableCell className={cn('text-right tabular-nums font-medium', l.saldo_com < margem && 'text-rose-600')}>{brl(l.saldo_com)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
