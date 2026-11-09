import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { hojeMes, semParcela } from '@/lib/format';
import { useDialogs } from '@/lib/dialogs';
import { NOVA } from '@/components/CategoriaSelect';

const Ctx = createContext(null);

export function DadosProvider({ children }) {
  const [mes, setMes] = useState(hojeMes());
  const [meses, setMeses] = useState(6);
  const [status, setStatus] = useState(null);
  const [categorias, setCategorias] = useState([]);
  const [relatorio, setRelatorio] = useState(null);
  const [transacoes, setTransacoes] = useState([]);
  const [planejamento, setPlanejamento] = useState([]);
  const [saldo, setSaldo] = useState({ valor: null, atualizado_em: null });
  const [carregando, setCarregando] = useState(true);
  const [versao, setVersao] = useState(0);

  const carregarStatus = useCallback(async () => {
    const s = await api('/api/status');
    setStatus(s);
    if (s.erro_storage) toast.error(`Banco: ${s.erro_storage}`);
    return s;
  }, []);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [cats, rel, tx, plan, sal] = await Promise.all([
        api('/api/categorias'),
        api(`/api/relatorio?mes=${mes}&meses=${meses}`),
        api(`/api/transacoes?mes=${mes}`),
        api('/api/planejamento'),
        api('/api/saldo'),
      ]);
      setCategorias(cats);
      setRelatorio(rel);
      setTransacoes(tx);
      setPlanejamento(plan);
      setSaldo(sal);
      setVersao((v) => v + 1);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setCarregando(false);
    }
  }, [mes, meses]);

  useEffect(() => { carregarStatus().catch((e) => toast.error(e.message)); }, [carregarStatus]);
  useEffect(() => { recarregar(); }, [recarregar]);

  const valor = {
    mes, setMes, meses, setMeses, status, carregarStatus, categorias, relatorio, transacoes,
    planejamento, saldo, carregando, recarregar, versao,
  };
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export const useDados = () => useContext(Ctx);

// Fluxo compartilhado de troca de categoria (transações e parcelamentos).
export function useMudarCategoria() {
  const { recarregar } = useDados();
  const dialogs = useDialogs();
  return async ({ id, estabelecimento, categoria, parcelamento = false }) => {
    try {
      let nova = categoria;
      if (nova === NOVA) {
        nova = await dialogs.prompt({ title: 'Nova categoria', label: 'Nome', placeholder: 'Ex.: Pets' });
        if (!nova) return;
        await api('/api/categorias', { method: 'POST', body: { nome: nova } });
      }
      const nome = semParcela(estabelecimento);
      const lembrar = await dialogs.escolha({
        title: `Mudar para "${nova}"`,
        description: parcelamento
          ? `Aplicar a todas as parcelas de "${nome}" (já lançadas e as próximas faturas)?`
          : `Aplicar também aos outros gastos de "${nome}" e às próximas faturas?`,
        opcoes: parcelamento
          ? [{ valor: 'nao', label: 'Só a última parcela' }, { valor: 'sim', label: 'Todas as parcelas', variant: 'default' }]
          : [{ valor: 'nao', label: 'Só este lançamento' }, { valor: 'sim', label: 'Todos, e lembrar', variant: 'default' }],
      });
      if (!lembrar) return;
      const r = await api(`/api/transacoes?id=${id}`, { method: 'PATCH', body: { categoria: nova, lembrar: lembrar === 'sim' } });
      toast.success(`${r.atualizadas} lançamento(s) atualizado(s)`);
      recarregar();
      return true;
    } catch (e) {
      toast.error(e.message);
    }
  };
}
