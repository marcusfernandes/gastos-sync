import { useState } from 'react';
import { FileUp, Mail, Play, TestTube2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useDados } from '@/lib/dados';
import { useDialogs } from '@/lib/dialogs';
import { dataHoraBR } from '@/lib/format';

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

  const u = status?.ultima_ingestao;
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
