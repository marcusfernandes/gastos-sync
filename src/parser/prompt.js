import { CATEGORIAS, TIPOS } from '../config.js';

export function schemaTransacoes(categorias = CATEGORIAS) {
  return {
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
          categoria: { type: 'string', enum: categorias },
          tipo: { type: 'string', enum: TIPOS },
          vencimento: {
            type: 'string',
            description: 'Somente para faturas: data de vencimento YYYY-MM-DD',
          },
          parcela_atual: { type: 'integer', description: 'Somente compras parceladas: número da parcela (X de X/Y)' },
          parcelas_total: { type: 'integer', description: 'Somente compras parceladas: total de parcelas (Y de X/Y)' },
        },
        required: ['data', 'valor', 'estabelecimento', 'conta_ou_cartao', 'categoria', 'tipo'],
      },
    },
  },
  required: ['transacoes'],
  };
}

export const transacoesSchema = schemaTransacoes();

export function buildPrompt(email, categorias = CATEGORIAS) {
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
- "categoria": escolha a mais provável pelo estabelecimento entre: ${categorias.join(', ')}. Se nenhuma servir com segurança, use "Outros". Pix recebido -> "Renda" se parecer salário/pagamento, senão "Transferências".
- E-mails encaminhados ("Forwarded message", "Mensagem encaminhada", "Fwd:"): use o remetente e o conteúdo da mensagem original.
- PDF de fatura de cartão anexado: extraia CADA lançamento da fatura como "compra" (data da compra, valor, estabelecimento) e, além deles, uma linha "fatura" com o valor total e o vencimento. Ignore pagamentos da fatura anterior, créditos, estornos e o resumo/limites. Para compras parceladas use o valor da parcela, acrescente "(parcela X/Y)" ao estabelecimento e preencha "parcela_atual" e "parcelas_total". Compras à vista ficam sem esses campos.
- PDF de extrato ou comprovante: extraia cada movimentação com o "tipo" adequado.
- Confirmação de pagamento de fatura ("Você pagou a fatura", "débito automático realizado") NÃO é gasto novo: não extraia nada, pois a fatura já foi registrada.
- Não invente dados.

E-mail:
De: ${email.from}
Assunto: ${email.subject}
Recebido em: ${email.date}

${email.body.slice(0, 12000)}${email.anexos?.length ? `\n\nAnexos em PDF: ${email.anexos.map((a) => a.filename).join(', ')}` : ''}`;
}
