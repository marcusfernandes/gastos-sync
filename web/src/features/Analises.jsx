import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Repeat, Sparkles, Target, TrendingUp, Trash2 } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { formatarBRL } from '@/components/tooltip';
import { api } from '@/lib/api';
import { brl, dataBR, dataHoraBR, eixoBRL, mesBR, mesBRCurto } from '@/lib/format';
import { useDados } from '@/lib/dados';
import { useDialogs } from '@/lib/dialogs';
import { useOrcamento } from '@/features/Orcamento';
import { cn } from '@/lib/utils';

export function Analises() {
  const { mes, versao, recarregar } = useDados();
  const [dados, setDados] = useState(null);
  const carregar = useCallback(() => api(`/api/analises?mes=${mes}`).then(setDados).catch((e) => toast.error(e.message)), [mes]);
  useEffect(() => { carregar(); }, [carregar, versao]);
  if (!dados) return <div className="grid gap-4"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>;
  return (
    <div className="grid gap-4">
      <PlanoCorte plano={dados.plano} />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Assinaturas a={dados.assinaturas} />
        <Conferencia c={dados.conferencia} aoMudar={() => { carregar(); recarregar(); }} />
      </div>
    </div>
  );
}

const TIPO = { orcamento: 'Meta', cancelar: 'Cancelar', renegociar: 'Renegociar', adiar: 'Adiar', outro: 'Ação' };
const graficoConfig = { sem_plano: { label: 'Sem o plano', color: 'var(--chart-4)' }, com_plano: { label: 'Com o plano', color: 'var(--chart-2)' } };

function PlanoCorte({ plano: inicial }) {
  const [plano, setPlano] = useState(inicial);
  const [gerando, setGerando] = useState(false);
  const { dados: orc, salvar } = useOrcamento();

  const gerar = async () => {
    setGerando(true);
    try {
      setPlano(await api('/api/plano-corte', { method: 'POST' }));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setGerando(false);
    }
  };

  const usarComoMeta = async (a) => {
    const item = orc?.itens.find((i) => i.categoria === a.categoria);
    const base = item?.limite || Math.max(item?.gasto || 0, item?.media || 0);
    const meta = Math.max(0, Math.round(base - a.economia_mensal));
    try {
      await salvar({ [a.categoria]: meta });
      toast.success(`Meta de ${a.categoria}: ${brl(meta)}/mês`);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const ultimo = plano?.saldos?.at(-1);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="grid gap-1.5">
          <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="size-4 text-primary" /> Plano de corte</CardTitle>
          <CardDescription>
            {plano ? `Gerado em ${dataHoraBR(plano.gerado_em)} com os dados de ${mesBR(plano.mes)}` : 'A IA olha a projeção, as categorias, as assinaturas e as parcelas e sugere onde cortar para o saldo não ficar negativo.'}
          </CardDescription>
        </div>
        <Button size="sm" onClick={gerar} disabled={gerando}><Sparkles className={cn(gerando && 'animate-pulse')} />{gerando ? 'Gerando...' : plano ? 'Gerar de novo' : 'Gerar plano'}</Button>
      </CardHeader>
      {plano && (
        <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="grid min-w-0 grid-cols-1 content-start gap-3 lg:col-span-3">
            <p className="text-sm">{plano.resumo}</p>
            {plano.acoes.map((a, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border px-3 py-2 text-sm">
                <Badge variant="outline" className="mt-0.5 shrink-0">{TIPO[a.tipo] || 'Ação'}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{a.titulo}</div>
                  <div className="text-xs text-muted-foreground">{a.detalhe}</div>
                  {a.tipo === 'orcamento' && a.categoria && (
                    <Button variant="link" size="xs" className="h-auto px-0" onClick={() => usarComoMeta(a)}><Target /> Usar como meta de {a.categoria}</Button>
                  )}
                </div>
                <span className="shrink-0 text-right font-medium tabular-nums text-emerald-600 dark:text-emerald-400"><span className="whitespace-nowrap">−{brl(a.economia_mensal)}</span><span className="text-xs">/mês</span></span>
              </div>
            ))}
          </div>
          <div className="grid min-w-0 grid-cols-1 content-start gap-2 lg:col-span-2">
            <div className="text-sm">
              Economia de <span className="font-semibold text-emerald-600 dark:text-emerald-400">{brl(plano.economia_mensal)}/mês</span>
              {ultimo && <> · em {mesBR(ultimo.mes)}: {brl(ultimo.sem_plano)} → <span className="font-semibold">{brl(ultimo.com_plano)}</span></>}
            </div>
            <ChartContainer config={graficoConfig} className="aspect-auto h-56 w-full">
              <LineChart data={plano.saldos.map((s) => ({ ...s, mes: mesBRCurto(s.mes) }))} margin={{ left: 4, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="mes" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={eixoBRL} tickLine={false} axisLine={false} width={60} />
                <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
                <ChartTooltip content={<ChartTooltipContent formatter={formatarBRL} />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Line dataKey="sem_plano" stroke="var(--color-sem_plano)" strokeWidth={2} dot={false} />
                <Line dataKey="com_plano" stroke="var(--color-com_plano)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function Assinaturas({ a }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Repeat className="size-4 text-primary" /> Assinaturas e recorrentes</CardTitle>
        <CardDescription>{a.itens.length ? `${a.itens.length} cobranças que se repetem · ${brl(a.total_mensal)}/mês` : 'Nenhuma cobrança recorrente encontrada nos últimos 6 meses'}</CardDescription>
      </CardHeader>
      {a.itens.length > 0 && (
        <CardContent className="grid gap-2">
          {a.itens.map((s) => (
            <div key={s.chave} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{s.estabelecimento}</div>
                <div className="text-xs text-muted-foreground">{s.conta_ou_cartao} · {s.categoria} · última {dataBR(s.ultima_data)}{!s.nova && ` · ${s.meses} meses`}</div>
              </div>
              {s.nova && <Badge variant="outline" className="shrink-0 border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300">Nova</Badge>}
              {s.aumento > 0 && (
                <Badge variant="outline" className="shrink-0 border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300" title={`Antes ${brl(s.valor_anterior)}`}>
                  <TrendingUp /> +{brl(s.aumento)}
                </Badge>
              )}
              <span className="shrink-0 whitespace-nowrap font-medium tabular-nums">{brl(s.valor)}</span>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

function Conferencia({ c, aoMudar }) {
  const dialogs = useDialogs();
  const apagar = async (t) => {
    if (!(await dialogs.confirm({ title: 'Apagar lançamento repetido?', description: `${t.estabelecimento} · ${brl(t.valor)} · ${dataBR(t.data)} (${t.conta_ou_cartao})`, confirmText: 'Apagar', destructive: true }))) return;
    try {
      await api(`/api/transacoes?id=${t.id}`, { method: 'DELETE' });
      toast.success('Lançamento apagado');
      aoMudar();
    } catch (e) {
      toast.error(e.message);
    }
  };
  const problemas = c.faturas.filter((f) => !f.confere).length + c.duplicadas.length + c.fora_do_padrao.length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="size-4 text-primary" /> Conferência de {mesBR(c.mes)}</CardTitle>
        <CardDescription>{problemas ? `${problemas} ponto${problemas > 1 ? 's' : ''} para revisar` : 'Nada estranho nas faturas deste mês'}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <section className="grid gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Fatura × soma das compras</h3>
          {c.faturas.length ? c.faturas.map((f) => (
            <div key={f.conta_ou_cartao} className="flex items-center gap-3 rounded-lg border px-3 py-2">
              {f.confere ? <CheckCircle2 className="size-4 shrink-0 text-emerald-500" /> : <AlertTriangle className="size-4 shrink-0 text-amber-500" />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{f.conta_ou_cartao}</div>
                <div className="text-xs text-muted-foreground">{f.compras} compras somam {brl(f.soma_compras)}{!f.confere && ` · diferença de ${brl(f.diferenca)}`}</div>
              </div>
              <span className="shrink-0 whitespace-nowrap tabular-nums">{brl(f.total_fatura)}</span>
            </div>
          )) : <p className="text-muted-foreground">Nenhuma fatura com compras detalhadas neste mês.</p>}
        </section>
        {c.duplicadas.length > 0 && (
          <section className="grid gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Possíveis compras repetidas</h3>
            {c.duplicadas.map(([x, y]) => (
              <div key={`${x.id}-${y.id}`} className="flex items-center gap-3 rounded-lg border border-amber-500/40 px-3 py-2">
                <Copy className="size-4 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{x.estabelecimento}</div>
                  <div className="text-xs text-muted-foreground">{x.conta_ou_cartao} · {dataBR(x.data)} e {dataBR(y.data)}{y.estabelecimento !== x.estabelecimento && ` ("${y.estabelecimento}")`}</div>
                </div>
                <span className="shrink-0 whitespace-nowrap tabular-nums">{brl(x.valor)}</span>
                <Button variant="ghost" size="icon-sm" title="Apagar a segunda" onClick={() => apagar(y)}><Trash2 /></Button>
              </div>
            ))}
          </section>
        )}
        {c.fora_do_padrao.length > 0 && (
          <section className="grid gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Fora do padrão</h3>
            {c.fora_do_padrao.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                <AlertTriangle className="size-4 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{t.estabelecimento}</div>
                  <div className="text-xs text-muted-foreground">{t.categoria} · {dataBR(t.data)} · {t.vezes}× o gasto típico ({brl(t.mediana_categoria)})</div>
                </div>
                <span className="shrink-0 whitespace-nowrap tabular-nums">{brl(t.valor)}</span>
              </div>
            ))}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
