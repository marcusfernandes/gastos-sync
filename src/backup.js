import { deflateRawSync } from 'node:zlib';

// Configurações que valem guardar. Tokens, senhas e chats do Telegram ficam de fora.
const CONFIGS = ['saldo_atual', 'orcamentos', 'metas_poupanca', 'contas_pagas', 'contas_dias', 'plano_corte', 'revisados'];
const ORDEM_TX = ['id', 'data', 'valor', 'estabelecimento', 'categoria', 'tipo', 'conta_ou_cartao', 'responsavel', 'parcela_atual', 'parcelas_total', 'vencimento'];
const DATA_RE = /^(\d{4})-(\d{2})-(\d{2})(T.*)?$/;

const celula = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v).replace('.', ',');
  if (typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  const d = v.match(DATA_RE);
  if (d && !d[4]) v = `${d[3]}/${d[2]}/${d[1]}`;
  return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

// CSV no jeito do Excel brasileiro: separador ";", vírgula decimal, datas dd/mm/aaaa e BOM UTF-8.
export function paraCsv(linhas, ordem = []) {
  const colunas = [...new Set([...ordem, ...linhas.flatMap((l) => Object.keys(l))])].filter((c) => linhas.some((l) => c in l) || !linhas.length);
  return `\uFEFF${[colunas.join(';'), ...linhas.map((l) => colunas.map((c) => celula(l[c])).join(';'))].join('\r\n')}\r\n`;
}

export async function gerarBackup(storage) {
  const [transacoes, planejamento, categorias, regras] = await Promise.all([
    storage.listTransacoes(),
    storage.listPlanejamento(),
    storage.listCategorias ? storage.listCategorias() : [],
    storage.listRegras ? storage.listRegras() : new Map(),
  ]);
  const configs = {};
  if (storage.getConfig) {
    for (const k of CONFIGS) {
      const v = await storage.getConfig(k);
      if (v === null || v === undefined) continue;
      try { configs[k] = typeof v === 'string' ? JSON.parse(v) : v; } catch { configs[k] = v; }
    }
  }
  return [
    { nome: 'transacoes.csv', conteudo: paraCsv(transacoes, ORDEM_TX) },
    { nome: 'planejamento.csv', conteudo: paraCsv(planejamento, ['id', 'descricao', 'valor', 'direcao', 'categoria', 'responsavel', 'recorrente', 'inicio', 'fim']) },
    { nome: 'categorias.csv', conteudo: paraCsv(categorias.map((nome) => ({ categoria: nome }))) },
    { nome: 'regras_categoria.csv', conteudo: paraCsv([...regras].map(([padrao, categoria]) => ({ padrao, categoria }))) },
    { nome: 'configuracoes.json', conteudo: `${JSON.stringify(configs, null, 2)}\n` },
    { nome: 'LEIA-ME.txt', conteudo: `Backup do gastos-sync gerado em ${new Date().toISOString()}.\nCSVs com separador ";", vírgula decimal e datas dd/mm/aaaa (abrem direto no Excel/Google Planilhas).\ntransacoes: ${transacoes.length} · planejamento: ${planejamento.length} · categorias: ${categorias.length}\n` },
  ];
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// ZIP mínimo (deflate), sem dependências.
export function zipar(arquivos, data = new Date()) {
  const dosHora = (data.getHours() << 11) | (data.getMinutes() << 5) | (data.getSeconds() >> 1);
  const dosData = ((data.getFullYear() - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate();
  const locais = [];
  const centrais = [];
  let offset = 0;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, 'utf8');
    const bruto = Buffer.from(a.conteudo, 'utf8');
    const comp = deflateRawSync(bruto);
    const crc = crc32(bruto);
    const cab = Buffer.alloc(30);
    cab.writeUInt32LE(0x04034b50, 0); cab.writeUInt16LE(20, 4); cab.writeUInt16LE(0x0800, 6); cab.writeUInt16LE(8, 8);
    cab.writeUInt16LE(dosHora, 10); cab.writeUInt16LE(dosData, 12); cab.writeUInt32LE(crc, 14);
    cab.writeUInt32LE(comp.length, 18); cab.writeUInt32LE(bruto.length, 22); cab.writeUInt16LE(nome.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(dosHora, 12); cen.writeUInt16LE(dosData, 14); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(bruto.length, 24); cen.writeUInt16LE(nome.length, 28); cen.writeUInt32LE(offset, 42);
    locais.push(cab, nome, comp);
    centrais.push(cen, nome);
    offset += cab.length + nome.length + comp.length;
  }
  const central = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(central.length, 12); fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, central, fim]);
}

export const nomeBackup = (hoje) => `gastos-sync-backup-${hoje}.zip`;
