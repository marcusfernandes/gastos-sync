import { CATEGORIAS, TIPOS } from '../config.js';

export const transacoesSchema = {
  type: 'object',
  properties: {
    transacoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          data: { type: 'string', description: 'Data da transação no formato YYYY-MM-DD' },
          valor: { type: 'number', description: 'Valor em reais, positivo, ponto como separador decimal' },
          estabelecimento: { type: 'string', description: 'Loja, pessoa ou empresa da transação' },
          conta_ou_cartao: { type: 'string', description: 'Banco/cartão de origem, ex: Nubank, Itaú Visa' },
          categoria: { type: 'string', enum: CATEGORIAS },
          tipo: { type: 'string', enum: TIPOS },
          vencimento: {
            type: 'string',
            description: 'Somente para faturas: data de vencimento YYYY-MM-DD',
          },
        },
        required: ['data', 'valor', 'estabelecimento', 'conta_ou_cartao', 'categoria', 'tipo'],
      },
    },
  },
  required: ['transacoes'],
};

export function buildPrompt(email) {
  return `Você extrai transações financeiras de e-mails de bancos brasileiros.

Regras:
- Retorne {"transacoes": []} se o e-mail não descrever uma transação concreta (marketing, segurança, login, ofertas, extrato sem valores).
- "tipo":
  - "compra": compra aprovada no cartão de crédito/débito.
  - "pix_enviado" / "pix_recebido": comprovantes de Pix ou TED.
  - "debito": débito automático, boleto pago, tarifa.
  - "fatura": fatura fechada/disponível. Use o valor TOTAL da fatura, "estabelecimento" = "Fatura <banco>", "data" = data de fechamento (ou a do e-mail) e preencha "vencimento".
  - "outro": qualquer outra movimentação com valor.
- "valor" sempre positivo, em reais (ex: "R$ 1.234,56" -> 1234.56).
- Se a data não estiver no corpo, use a data de recebimento do e-mail: ${email.date.slice(0, 10)}.
- "conta_ou_cartao": nome do banco e, se houver, o cartão (ex: "Nubank", "Itaú Personnalité Visa final 1234").
- "categoria": escolha a mais provável pelo estabelecimento. Pix recebido -> "Renda" se parecer salário/pagamento, senão "Transferências".
- Não invente dados.

E-mail:
De: ${email.from}
Assunto: ${email.subject}
Recebido em: ${email.date}

${email.body.slice(0, 12000)}`;
}
