import { useEffect, useState } from 'react';
import { KeyRound, Loader2, Trash2, UserPlus, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { useDialogs } from '@/lib/dialogs';

export function Login({ onEntrar }) {
  const [usuario, setUsuario] = useState(() => localStorage.getItem('ultimo_usuario') || '');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  const entrar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    setErro('');
    try {
      const u = await api('/api/login', { method: 'POST', body: { usuario, senha } });
      localStorage.setItem('ultimo_usuario', usuario);
      onEntrar(u);
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mx-auto mb-2 rounded-xl bg-primary p-2.5 text-primary-foreground"><Wallet className="size-6" /></div>
          <CardTitle>gastos-sync</CardTitle>
          <CardDescription>Entre para ver as finanças da casa</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={entrar} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="usuario">Nome</Label>
              <Input id="usuario" autoComplete="username" placeholder="Marcão ou Becca" value={usuario} onChange={(e) => setUsuario(e.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="senha">Senha</Label>
              <Input id="senha" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required autoFocus={Boolean(usuario)} />
            </div>
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            <Button type="submit" disabled={enviando}>{enviando && <Loader2 className="animate-spin" />} Entrar</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export function Usuarios() {
  const dialogs = useDialogs();
  const [eu, setEu] = useState(null);
  const [lista, setLista] = useState([]);
  const [nome, setNome] = useState('');
  const [senha, setSenha] = useState('');

  useEffect(() => {
    Promise.all([api('/api/eu'), api('/api/usuarios')]).then(([e, l]) => { setEu(e); setLista(l); }).catch((e) => toast.error(e.message));
  }, []);

  const salvar = async (e) => {
    e.preventDefault();
    try {
      setLista(await api('/api/usuarios', { method: 'PUT', body: { nome: eu.admin ? nome : eu.nome, senha } }));
      toast.success('Senha salva');
      setNome('');
      setSenha('');
    } catch (err) { toast.error(err.message); }
  };
  const remover = async (n) => {
    if (!(await dialogs.confirm({ title: `Remover o acesso de ${n}?`, description: 'Deixa de conseguir entrar no painel. Os dados continuam.', confirmText: 'Remover', destructive: true }))) return;
    try { setLista(await api(`/api/usuarios?nome=${encodeURIComponent(n)}`, { method: 'DELETE' })); } catch (err) { toast.error(err.message); }
  };

  if (!eu) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="size-4 text-primary" /> Acessos</CardTitle>
        <CardDescription>
          Você entrou como <b>{eu.nome}</b>. Todos veem os mesmos dados da casa.
          {eu.admin ? ' A sua senha é a PAINEL_SENHA do servidor; aqui você cria ou troca a senha dos outros.' : ' Aqui você troca a sua senha.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          {lista.map((u) => (
            <Badge key={u.nome} variant={u.admin ? 'default' : 'secondary'} className="gap-1 py-1">
              {u.nome}{u.admin && ' · principal'}
              {eu.admin && !u.admin && <button type="button" onClick={() => remover(u.nome)} aria-label={`Remover ${u.nome}`}><Trash2 className="size-3" /></button>}
            </Badge>
          ))}
        </div>
        {(eu.admin || lista.some((u) => u.nome === eu.nome && !u.admin)) && (
          <form onSubmit={salvar} className="flex flex-col gap-2 sm:flex-row">
            {eu.admin && <Input className="h-9 sm:w-40" placeholder="Nome (ex.: Becca)" value={nome} onChange={(e) => setNome(e.target.value)} required />}
            <Input className="h-9 sm:w-48" type="password" autoComplete="new-password" placeholder={eu.admin ? 'Senha (mín. 8)' : 'Nova senha (mín. 8)'} value={senha} onChange={(e) => setSenha(e.target.value)} required minLength={8} />
            <Button type="submit" size="sm" className="h-9"><UserPlus /> {eu.admin ? 'Criar ou trocar senha' : 'Trocar senha'}</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
