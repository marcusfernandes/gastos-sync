import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const Ctx = createContext(null);

// confirm/prompt em diálogo, retornando Promise (substitui window.confirm/prompt).
export function DialogsProvider({ children }) {
  const [estado, setEstado] = useState(null);
  const [valor, setValor] = useState('');
  const resolver = useRef(null);

  const abrir = useCallback((cfg) => new Promise((resolve) => {
    resolver.current = resolve;
    setValor(cfg.defaultValue ?? '');
    setEstado(cfg);
  }), []);

  const fechar = (resultado) => {
    resolver.current?.(resultado);
    resolver.current = null;
    setEstado(null);
  };

  const api = useRef({
    confirm: (cfg) => abrir({ tipo: 'confirm', ...cfg }),
    prompt: (cfg) => abrir({ tipo: 'prompt', ...cfg }),
    escolha: (cfg) => abrir({ tipo: 'escolha', ...cfg }),
  }).current;

  const cancelar = () => fechar(estado?.tipo === 'prompt' ? null : estado?.tipo === 'escolha' ? null : false);

  return (
    <Ctx.Provider value={api}>
      {children}
      <Dialog open={!!estado} onOpenChange={(o) => !o && cancelar()}>
        {estado && (
          <DialogContent className="sm:max-w-md">
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (estado.tipo === 'prompt') fechar(valor.trim() || null);
                else if (estado.tipo === 'confirm') fechar(true);
              }}
            >
              <DialogHeader>
                <DialogTitle>{estado.title}</DialogTitle>
                {estado.description && <DialogDescription>{estado.description}</DialogDescription>}
              </DialogHeader>
              {estado.tipo === 'prompt' && (
                <div className="grid gap-2">
                  {estado.label && <Label htmlFor="dlg-input">{estado.label}</Label>}
                  <Input id="dlg-input" autoFocus value={valor} onChange={(e) => setValor(e.target.value)} placeholder={estado.placeholder} />
                </div>
              )}
              {estado.children}
              <DialogFooter className="gap-2">
                {estado.tipo === 'escolha' ? (
                  estado.opcoes.map((o) => (
                    <Button key={o.valor} type="button" variant={o.variant || 'outline'} onClick={() => fechar(o.valor)}>
                      {o.label}
                    </Button>
                  ))
                ) : (
                  <>
                    <Button type="button" variant="outline" onClick={cancelar}>{estado.cancelText || 'Cancelar'}</Button>
                    <Button type="submit" variant={estado.destructive ? 'destructive' : 'default'}>{estado.confirmText || 'Confirmar'}</Button>
                  </>
                )}
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </Ctx.Provider>
  );
}

export const useDialogs = () => useContext(Ctx);
