import { useState } from 'react';
import { FileUp, Landmark, Mail, Play, Send, TestTube2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useDados } from '@/lib/dados';
import { useDialogs } from '@/lib/dialogs';
import { brl, dataBR, dataHoraBR } from '@/lib/format';

const lerBase64 = (file) => new Promise((ok, fail) => {
  const fr = new FileReader();
  fr.onload = () => ok(String(fr.result).split(',')[1]);
  fr.onerror = fail;
  fr.readAsDataURL(file);
});

function Saida({ texto }) {
  if (!texto) return null;
  return <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap">{texto}</pre>;
}

export function Ferramentas() {
  const { recarregar, carregarStatus, status } = useDados();
  const dialogs = useDialogs();
  const [ocupado, setOcupado] = useState(false);
  const [saidaIng, setSaidaIng] = useState('');
  const [saidaParser, setSaidaParser] = useState('');
  const [assunto, setAssunto] = useState('');
  const [remetente, setRemetente] = useState('');
  const [texto, setTexto] = useState('');
  const [pdf, setPdf] = useState(null);

  const ingerir = async (dryRun) => {
    if (!dryRun && !(await dialogs.confirm({ title: 'Rodar ingestão agora?', description: 'Grava as transações encontradas e marca os e-mails como processados.', confirmText: 'Rodar' }))) return;
    setOcupado(true);
    setSaidaIng('Buscando e-mails e consultando o Gemini… (pode levar alguns minutos)');
    try {
      const r = await api('/api/ingest', { method: 'POST', body: { dryRun } });
      setSaidaIng(r.logs.join('\n') + (r.erros.length ? `\n\nErros:\n${JSON.stringify(r.erros, null, 2)}` : ''));
      if (!dryRun) { recarregar(); carregarStatus(); toast.success(`${r.inseridas} transação(ões) nova(s)`); }
    } catch (e) {
      setSaidaIng(`Erro: ${e.message}${e.data?.logs ? `\n${e.data.logs.join('\n')}` : ''}`);
    } finally { setOcupado(false); }
  };

  const testar = async (salvar) => {
    setOcupado(true);
    setSaidaParser('Consultando o Gemini…');
    try {
      const anexos = [];
      if (pdf) {
        if (pdf.size > 15 * 1024 * 1024) throw new Error('PDF maior que 15 MB');
        anexos.push({ filename: pdf.name, mimeType: 'application/pdf', data: await lerBase64(pdf) });
        setSaidaParser('Lendo o PDF com o Gemini… (faturas longas podem levar até 1 min)');
      }
      const r = await api('/api/parse', { method: 'POST', body: { texto, assunto: assunto || pdf?.name || '', remetente, anexos, salvar } });
      setSaidaParser(JSON.stringify(r.transacoes, null, 2) + (r.salvas ? `\n\nSalvas: ${r.salvas.inserted.length} | Duplicadas: ${r.salvas.skipped}` : ''));
      if (salvar) recarregar();
    } catch (e) { setSaidaParser(`Erro: ${e.message}`); } finally { setOcupado(false); }
  };

  const [saidaOF, setSaidaOF] = useState('');
  const openFinance = async (dryRun, dias) => {
    if (!dryRun && !(await dialogs.confirm({ title: dias ? 'Importar 12 meses do Open Finance?' : 'Sincronizar Open Finance?', description: 'Grava as movimentações novas dos bancos conectados e atualiza o saldo atual.', confirmText: 'Importar' }))) return;
    setOcupado(true);
    setSaidaOF('Consultando os bancos pela Pluggy…');
    try {
      const r = await api('/api/pluggy/sync', { method: 'POST', body: { dryRun, dias } });
      setSaidaOF(`${r.logs.join('\n')}\n\n${dryRun ? 'Seriam gravadas' : 'Gravadas'}: ${r.novas} · já existiam: ${r.ignoradas}${r.saldo != null ? ` · saldo nas contas: ${brl(r.saldo)}` : ''}`);
      if (!dryRun) { recarregar(); carregarStatus(); toast.success(`${r.novas} movimentação(ões) nova(s)`); }
    } catch (e) { setSaidaOF(`Erro: ${e.message}`); } finally { setOcupado(false); }
  };

  const u = status?.ultima_ingestao;
  const of = status?.pluggy;
  const expira = (of?.itens || []).map((i) => i.consentimento_expira).filter(Boolean).sort()[0];
  const diasExpira = expira ? Math.ceil((new Date(expira) - Date.now()) / 864e5) : null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Mail className="size-4 text-primary" /> Ingestão do Gmail</CardTitle>
          <CardDescription>
            Roda sozinha a cada 3 horas. Lê e-mails de bancos, o que você encaminha para o endereço +gastos e PDFs de fatura/extrato que você manda para si mesmo.
            {u && <> Última: {dataHoraBR(u.quando)} · {u.inseridas} nova(s).</>}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={ocupado} onClick={() => ingerir(true)}><TestTube2 /> Simular (não grava)</Button>
            <Button disabled={ocupado} onClick={() => ingerir(false)}><Play /> Rodar agora</Button>
          </div>
          <Saida texto={saidaIng} />
        </CardContent>
      </Card>
      {status?.configurado?.telegram && <Telegram chats={status.telegram_chats || []} />}
      {status?.configurado?.pluggy && (
        <Card className={diasExpira != null && diasExpira <= 30 ? 'border-amber-500/50' : ''}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Landmark className="size-4 text-primary" /> Open Finance (Meu Pluggy)</CardTitle>
            <CardDescription>
              Sincroniza junto com a ingestão a cada 3 horas. Os bancos atualizam na Pluggy uma vez por dia.
              {of && <> Última: {dataHoraBR(of.em)} · {of.novas} nova(s).</>}
              {expira && <> Autorização vence em {dataBR(expira.slice(0, 10))}{diasExpira <= 30 && ' — renove no Meu Pluggy'}.</>}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {of?.itens?.length > 0 && (
              <ul className="grid gap-1 text-sm">
                {of.itens.map((i) => (
                  <li key={i.id}>
                    <span className="font-medium">{i.banco}</span>{' '}
                    <span className={i.erro || !['UPDATED', 'UPDATING'].includes(i.status) ? 'text-amber-600' : 'text-muted-foreground'}>{i.erro || i.status}</span>
                    <span className="text-muted-foreground"> · {i.contas.map((c) => c.nome).join(', ')}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={ocupado} onClick={() => openFinance(true)}><TestTube2 /> Simular</Button>
              <Button disabled={ocupado} onClick={() => openFinance(false)}><Play /> Sincronizar</Button>
              <Button variant="outline" disabled={ocupado} onClick={() => openFinance(false, 365)}>Importar 12 meses</Button>
            </div>
            <Saida texto={saidaOF} />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><FileUp className="size-4 text-primary" /> Testar leitura</CardTitle>
          <CardDescription>Cole o texto de um e-mail do banco ou envie o PDF da fatura.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input className="h-9" placeholder="Assunto (opcional)" value={assunto} onChange={(e) => setAssunto(e.target.value)} />
            <Input className="h-9" placeholder="Remetente (opcional)" value={remetente} onChange={(e) => setRemetente(e.target.value)} />
          </div>
          <Textarea rows={5} placeholder="Cole aqui o texto ou o HTML do e-mail…" value={texto} onChange={(e) => setTexto(e.target.value)} />
          <Input type="file" accept="application/pdf,.pdf" onChange={(e) => setPdf(e.target.files[0] || null)} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={ocupado} onClick={() => testar(false)}>Extrair</Button>
            <Button disabled={ocupado} onClick={() => testar(true)}>Extrair e salvar</Button>
          </div>
          <Saida texto={saidaParser} />
        </CardContent>
      </Card>
    </div>
  );
}

function Telegram({ chats }) {
  const [enviando, setEnviando] = useState(false);
  const testar = async () => {
    setEnviando(true);
    try {
      const r = await api('/api/telegram/teste', { method: 'POST' });
      toast.success(`Mensagem enviada para ${r.enviados} chat(s)`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Send className="size-4 text-primary" /> Bot do Telegram</CardTitle>
        <CardDescription>
          {chats.length ? `Conectado: ${chats.join(', ')}.` : 'Nenhum chat conectado ainda.'} Para conectar, abra o bot e mande <code>/start</code> seguido da senha do painel.
          Avisos de contas saem uma vez por dia, a partir das 8h, e o resumo semanal às segundas.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" size="sm" disabled={enviando || !chats.length} onClick={testar}><Send /> Enviar mensagem de teste</Button>
      </CardContent>
    </Card>
  );
}
