const DEFAULT_GMAIL_QUERY = [
  'from:(nubank.com.br OR itau.com.br OR bb.com.br OR bancointer.com.br OR inter.co',
  'OR c6bank.com.br OR bradesco.com.br OR santander.com.br OR caixa.gov.br',
  'OR mercadopago.com OR picpay.com OR xpi.com.br OR btgpactual.com)',
].join(' ');

export const CATEGORIAS = [
  'Alimentação',
  'Mercado',
  'Transporte',
  'Moradia',
  'Contas e Serviços',
  'Saúde',
  'Educação',
  'Lazer',
  'Compras',
  'Assinaturas',
  'Viagem',
  'Mudança',
  'Transferências',
  'Renda',
  'Impostos e Taxas',
  'Outros',
];

export const TIPOS = ['compra', 'pix_enviado', 'pix_recebido', 'debito', 'fatura', 'outro'];

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

function int(name, fallback) {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : fallback;
  if (Number.isNaN(n)) throw new Error(`${name} deve ser um número inteiro`);
  return n;
}

export function publicUrl() {
  return (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
}

export function googleRedirectUri() {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  return publicUrl() ? `${publicUrl()}/oauth2callback` : 'http://localhost:53682/oauth2callback';
}

export const config = {
  get gmail() {
    return {
      clientId: required('GOOGLE_CLIENT_ID'),
      clientSecret: required('GOOGLE_CLIENT_SECRET'),
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN || null,
      redirectUri: googleRedirectUri(),
      query: process.env.GMAIL_QUERY || DEFAULT_GMAIL_QUERY,
      lookbackDays: int('GMAIL_LOOKBACK_DAYS', 7),
      maxMessages: int('GMAIL_MAX_MESSAGES', 50),
      processedLabel: process.env.GMAIL_PROCESSED_LABEL || 'gastos-sync/processado',
    };
  },
  get gemini() {
    return {
      apiKey: required('GEMINI_API_KEY'),
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    };
  },
  get storageBackend() {
    return (process.env.STORAGE_BACKEND || 'supabase').toLowerCase();
  },
  get supabase() {
    return {
      url: required('SUPABASE_URL'),
      serviceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    };
  },
  get sheets() {
    return {
      spreadsheetId: required('GOOGLE_SHEETS_ID'),
      sheetName: process.env.GOOGLE_SHEETS_TAB || 'transacoes',
    };
  },
  get summary() {
    return {
      saldoInicial: Number(process.env.SALDO_INICIAL || 0),
      mesesHistoricoVariavel: int('MESES_HISTORICO_VARIAVEL', 3),
      port: int('PORT', 3000),
    };
  },
  get painel() {
    return { senha: process.env.PAINEL_SENHA || null };
  },
};
