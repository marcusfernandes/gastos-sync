import { useEffect, useState } from 'react';
import { BarChart3, Lightbulb, Calculator, LayoutDashboard, ListChecks, Loader2, LogOut, Mail, Moon, MoreVertical, RefreshCw, Sparkles, Sun, Tags, Wallet, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MonthPicker } from '@/components/MonthPicker';
import { DadosProvider, useDados } from '@/lib/dados';
import { DialogsProvider } from '@/lib/dialogs';
import { dataHoraBR } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Visao } from '@/features/Visao';
import { Graficos } from '@/features/Graficos';
import { Transacoes } from '@/features/Transacoes';
import { Planejamento } from '@/features/Planejamento';
import { Categorias } from '@/features/Categorias';
import { Ferramentas } from '@/features/Ferramentas';
import { Chat } from '@/features/Chat';
import { Simulador } from '@/features/Simulador';
import { Analises } from '@/features/Analises';
import { Login } from '@/features/Login';
import { api } from '@/lib/api';

const ABAS = [
  ['visao', 'Visão geral', LayoutDashboard, Visao],
  ['graficos', 'Gráficos', BarChart3, Graficos],
  ['analises', 'Análises', Lightbulb, Analises],
  ['simulador', 'Simular compra', Calculator, Simulador],
  ['transacoes', 'Transações', ListChecks, Transacoes],
  ['planejamento', 'Receitas e fixos', Wallet, Planejamento],
  ['categorias', 'Categorias', Tags, Categorias],
  ['ferramentas', 'Gmail e testes', Wrench, Ferramentas],
];

function useTema() {
  const [escuro, setEscuro] = useState(() => localStorage.getItem('tema') ? localStorage.getItem('tema') === 'escuro' : matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', escuro);
    localStorage.setItem('tema', escuro ? 'escuro' : 'claro');
  }, [escuro]);
  return [escuro, setEscuro];
}

function Ponto({ ok, label }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn('size-2 rounded-full', ok ? 'bg-emerald-500' : 'bg-rose-500')} />{label}
    </span>
  );
}

function Painel({ usuario, onSair }) {
  const { mes, setMes, status, recarregar, carregando } = useDados();
  const [escuro, setEscuro] = useTema();
  const [aba, setAba] = useState(() => location.hash.slice(1) || 'visao');
  const [chat, setChat] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(location.search).get('gmail') === 'conectado') {
      toast.success('Gmail conectado!');
      history.replaceState(null, '', '/');
    }
  }, []);
  useEffect(() => { history.replaceState(null, '', `#${aba}`); }, [aba]);
  useEffect(() => {
    const onHash = () => setAba(location.hash.slice(1) || 'visao');
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-primary p-1.5 text-primary-foreground"><Wallet className="size-4" /></div>
            <div className="leading-tight">
              <div className="font-semibold">gastos-sync</div>
              {status?.ultima_ingestao && <div className="hidden text-[11px] text-muted-foreground sm:block">Última leitura do Gmail: {dataHoraBR(status.ultima_ingestao.quando)}</div>}
            </div>
          </div>
          <div className="ml-4 hidden items-center gap-3 lg:flex">
            {status && <>
              <Ponto ok={status.configurado.gemini} label="Gemini" />
              <Ponto ok={status.configurado.storage && !status.erro_storage} label="Banco" />
              <Ponto ok={status.gmail_conectado} label="Gmail" />
            </>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <MonthPicker value={mes} onChange={setMes} className="w-32 sm:w-36" />
            <Button variant="ghost" size="icon" className="hidden sm:inline-flex" onClick={recarregar} title="Atualizar"><RefreshCw className={cn(carregando && 'animate-spin')} /></Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {status && <DropdownMenuLabel className="flex gap-3 lg:hidden">
                  <Ponto ok={status.configurado.gemini} label="Gemini" />
                  <Ponto ok={status.configurado.storage && !status.erro_storage} label="Banco" />
                  <Ponto ok={status.gmail_conectado} label="Gmail" />
                </DropdownMenuLabel>}
                <DropdownMenuSeparator className="lg:hidden" />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Entrou como {usuario.nome}</DropdownMenuLabel>
                <DropdownMenuItem onClick={recarregar}><RefreshCw /> Atualizar dados</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setEscuro(!escuro)}>{escuro ? <Sun /> : <Moon />} Tema {escuro ? 'claro' : 'escuro'}</DropdownMenuItem>
                {status?.configurado.google_oauth && (
                  <DropdownMenuItem asChild><a href="/auth/google"><Mail /> {status.gmail_conectado ? 'Reconectar Gmail' : 'Conectar Gmail'}</a></DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onSair}><LogOut /> Sair</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pt-4 pb-24">
        <Tabs value={aba} onValueChange={setAba} className="gap-4">
          <div className="scrollbar-none -mx-4 overflow-x-auto px-4">
            <TabsList className="w-max">
              {ABAS.map(([k, l, Icone]) => (
                <TabsTrigger key={k} value={k} className="gap-1.5 px-3"><Icone className="size-4" />{l}</TabsTrigger>
              ))}
            </TabsList>
          </div>
          {ABAS.map(([k, , , Comp]) => <TabsContent key={k} value={k}>{aba === k && <Comp />}</TabsContent>)}
        </Tabs>
      </main>

      <Button size="lg" className="fixed right-4 bottom-4 z-40 size-12 rounded-full shadow-lg shadow-primary/30 sm:w-auto sm:px-5" onClick={() => setChat(true)}>
        <Sparkles /><span className="hidden sm:inline">Perguntar à IA</span>
      </Button>
      <Chat aberto={chat} onOpenChange={setChat} />
    </div>
  );
}

export default function App() {
  const [usuario, setUsuario] = useState(undefined);
  useEffect(() => {
    api('/api/eu').then(setUsuario).catch(() => setUsuario(null));
    const expirou = () => setUsuario(null);
    addEventListener('sessao-expirada', expirou);
    return () => removeEventListener('sessao-expirada', expirou);
  }, []);
  const sair = async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    setUsuario(null);
  };

  return (
    <TooltipProvider>
      <DialogsProvider>
        {usuario === undefined && <div className="grid min-h-dvh place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>}
        {usuario === null && <Login onEntrar={setUsuario} />}
        {usuario && (
          <DadosProvider>
            <Painel usuario={usuario} onSair={sair} />
          </DadosProvider>
        )}
        <Toaster richColors position="top-center" />
      </DialogsProvider>
    </TooltipProvider>
  );
}
