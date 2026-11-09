import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Bot, Loader2, Send, Sparkles, Trash2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const SUGESTOES = [
  'Com o que estamos gastando mais?',
  'Como podemos diminuir custos?',
  'Qual o melhor mês para comprar algo de R$ 3.000?',
  'Quais assinaturas e parcelas pesam mais?',
  'O que mudou nos gastos deste mês em relação ao anterior?',
];
const CHAVE = 'gastos-sync-chat';

export function Chat({ aberto, onOpenChange }) {
  const [mensagens, setMensagens] = useState(() => JSON.parse(localStorage.getItem(CHAVE) || '[]'));
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const fim = useRef(null);

  useEffect(() => { localStorage.setItem(CHAVE, JSON.stringify(mensagens.slice(-40))); }, [mensagens]);
  useEffect(() => { fim.current?.scrollIntoView({ behavior: 'smooth' }); }, [mensagens, pensando, aberto]);

  const enviar = async (pergunta) => {
    const t = (pergunta ?? texto).trim();
    if (!t || pensando) return;
    const novas = [...mensagens, { role: 'user', texto: t }];
    setMensagens(novas);
    setTexto('');
    setPensando(true);
    try {
      const r = await api('/api/chat', { method: 'POST', body: { mensagens: novas.filter((m) => !m.erro) } });
      setMensagens((m) => [...m, { role: 'assistant', texto: r.resposta }]);
    } catch (e) {
      setMensagens((m) => [...m, { role: 'assistant', texto: `Não consegui responder: ${e.message}`, erro: true }]);
    } finally { setPensando(false); }
  };

  return (
    <Sheet open={aberto} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Assistente financeiro</SheetTitle>
          <SheetDescription>Responde com base nas suas transações, faturas, receitas, fixos, parcelas e projeção.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          {mensagens.length === 0 && (
            <div className="grid gap-3 pt-6">
              <div className="mx-auto rounded-full bg-primary/10 p-3"><Bot className="size-6 text-primary" /></div>
              <p className="text-center text-sm text-muted-foreground">Pergunte qualquer coisa sobre o orçamento de vocês.</p>
              <div className="grid gap-2">
                {SUGESTOES.map((s) => (
                  <Button key={s} variant="outline" className="h-auto justify-start py-2 text-left whitespace-normal" onClick={() => enviar(s)}>{s}</Button>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-3">
            {mensagens.map((m, i) => (
              <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[90%] rounded-2xl px-3.5 py-2 text-sm',
                  m.role === 'user' ? 'rounded-br-sm bg-primary text-primary-foreground' : 'md rounded-bl-sm bg-muted',
                  m.erro && 'bg-destructive/10 text-destructive')}>
                  {m.role === 'user' ? m.texto : <Markdown>{m.texto}</Markdown>}
                </div>
              </div>
            ))}
            {pensando && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Analisando seus dados…</div>
            )}
            <div ref={fim} />
          </div>
        </div>
        <form className="grid gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); enviar(); }}>
          <Textarea
            rows={2}
            className="max-h-40 resize-none"
            placeholder="Ex.: Dá para trocar o sofá de R$ 4.000 em março?"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
          />
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={!mensagens.length || pensando} onClick={() => setMensagens([])}><Trash2 /> Limpar conversa</Button>
            <Button type="submit" size="sm" disabled={!texto.trim() || pensando}><Send /> Enviar</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
