// ================================================================
// api/checkout-getnet.js — Processa pagamentos via Getnet
// ================================================================
// Variáveis de ambiente no Vercel → Settings → Environment Variables:
//
//   GETNET_CLIENT_ID     → seu Client ID
//   GETNET_CLIENT_SECRET → seu Client Secret
//   GETNET_SELLER_ID     → seu Seller ID
//   GETNET_SANDBOX       → "true" em teste, "false" em produção
//
// ================================================================

const GETNET_CLIENT_ID     = process.env.GETNET_CLIENT_ID     || "sbx_0b70ae43-b638-4f02-9e50-fe16ae0c571a";
const GETNET_CLIENT_SECRET = process.env.GETNET_CLIENT_SECRET || "5c90c3f7-e435-482b-902e-dfb9d1585aab";
const GETNET_SELLER_ID     = process.env.GETNET_SELLER_ID     || "192ec5f4-31af-4652-aecc-ea1032a38f37";
const GETNET_SANDBOX       = process.env.GETNET_SANDBOX !== "false";

const GETNET_URL = GETNET_SANDBOX
  ? "https://api-sbx.globalgetnet.com"
  : "https://api.globalgetnet.com";

// Supabase — salva pedidos no painel admin
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";

/* ── Gera token de acesso Getnet ── */
async function getToken() {
  const res = await fetch(`${GETNET_URL}/authentication/oauth2/access_token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${Buffer.from(`${GETNET_CLIENT_ID}:${GETNET_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Erro ao obter token: ${JSON.stringify(data)}`);
  return data.access_token;
}

/* ── Tokeniza o número do cartão ── */
async function tokenizeCard(token, cardNumber, customerId) {
  const res = await fetch(`${GETNET_URL}/dpm/payments-gwproxy/v2/tokens/card`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-seller-id": GETNET_SELLER_ID,
    },
    body: JSON.stringify({
      card_number: cardNumber.replace(/\s/g, ""),
      customer_id: customerId,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Erro ao tokenizar cartão: ${JSON.stringify(data)}`);
  return data.number_token;
}

/* ── Salva pedido no Supabase ── */
async function saveOrder(order) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/pedidos`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(order),
    });
  } catch (err) {
    console.error("Erro ao salvar no Supabase:", err);
  }
}

/* ── Handler principal ── */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const {
      amount,           // valor em centavos (ex: R$199,90 = 19990)
      installments,     // parcelas
      cardNumber,       // número do cartão
      cardExpiry,       // "MM/YYYY"
      cardCvv,
      cardHolder,
      customerName,
      customerCpf,
      customerEmail,
      customerPhone,
      kind,             // "credit", "debit" ou "pix"
      reference,        // ex: "GAMA-001"
      items,            // descrição dos itens
    } = req.body;

    // gera token de acesso
    const accessToken = await getToken();

    const orderId    = reference || `GAMA-${Date.now()}`;
    const customerId = `customer-${customerCpf.replace(/\D/g, "")}`;
    const amountNum  = Number(amount);

    // ── PIX ──────────────────────────────────────────────────────
    if (kind === "pix") {
      const pixBody = {
        seller_id: GETNET_SELLER_ID,
        order_id:  orderId,
        amount:    amountNum,
        currency:  "BRL",
        customer: {
          customer_id:    customerId,
          first_name:     customerName.split(" ")[0],
          last_name:      customerName.split(" ").slice(1).join(" ") || ".",
          document_type:  "CPF",
          document_number: customerCpf.replace(/\D/g, ""),
          email:          customerEmail,
          phone_number:   customerPhone.replace(/\D/g, ""),
        },
        additional_data: {
          payer_request: "Gama Móveis",
        },
      };

      const pixRes = await fetch(`${GETNET_URL}/dpm/payments-gwproxy/v2/payments`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "x-seller-id": GETNET_SELLER_ID,
        },
        body: JSON.stringify(pixBody),
      });

      const pixData = await pixRes.json();
      if (!pixRes.ok) throw new Error(`Erro Pix: ${JSON.stringify(pixData)}`);

      await saveOrder({
        tid:            pixData.payment_id || orderId,
        reference:      orderId,
        status:         "pending",
        kind:           "pix",
        amount:         amountNum,
        installments:   1,
        customer_name:  customerName,
        customer_email: customerEmail,
        customer_cpf:   customerCpf.replace(/\D/g, ""),
        items:          items || "",
        auth_code:      "",
        return_code:    "pending",
      });

      return res.status(200).json({
        kind:       "pix",
        payment_id: pixData.payment_id,
        qrCode:     pixData.additional_data?.qr_code,
        qrCodeImage: pixData.additional_data?.qr_code_image,
        expiresAt:  pixData.additional_data?.expiration_time,
        status:     "pending",
      });
    }

    // ── CARTÃO CRÉDITO / DÉBITO ───────────────────────────────────
    // aceita MM/AA ou MM/AAAA — sempre envia 2 dígitos para a Getnet
    const [expMonth, expYearRaw] = (cardExpiry || "").split("/");
    const expYear = (expYearRaw || "").slice(-2);

    // tokeniza o cartão (obrigatório na Getnet)
    const numberToken = await tokenizeCard(accessToken, cardNumber, customerId);

    const paymentMethod = kind === "debit" ? "DEBIT" : "CREDIT";
    const cardBody = {
      idempotency_key: `${orderId}-${Date.now()}`,
      order_id:        orderId,
      data: {
        amount:      amountNum,
        currency:    "BRL",
        customer_id: customerId,
        payment: {
          payment_method:      `${paymentMethod}_AUTHORIZATION`,
          save_card_data:      false,
          transaction_type:    "FULL",
          number_installments: Number(installments) || 1,
          soft_descriptor:     "GAMA MOVEIS",
          dynamic_mcc:         5712,
          card: {
            number_token:     numberToken,
            cardholder_name:  cardHolder,
            security_code:    cardCvv,
            brand:            detectBrand(cardNumber),
            expiration_month: expMonth,
            expiration_year:  expYear,
          },
        },
      },
    };

    const endpoint = `${GETNET_URL}/dpm/payments-gwproxy/v2/payments`;

    const cardRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "x-seller-id": GETNET_SELLER_ID,
      },
      body: JSON.stringify(cardBody),
    });

    const cardData = await cardRes.json();
    if (!cardRes.ok) throw new Error(`Erro cartão: ${JSON.stringify(cardData)}`);

    const approved  = cardData.status === "AUTHORIZED" || cardData.status === "APPROVED";
    const paymentId = cardData.payment_id || orderId;
    const authCode  = cardData.authorization_code || "";

    await saveOrder({
      tid:            paymentId,
      reference:      orderId,
      status:         approved ? "approved" : "declined",
      kind,
      amount:         amountNum,
      installments:   Number(installments) || 1,
      customer_name:  customerName,
      customer_email: customerEmail,
      customer_cpf:   customerCpf.replace(/\D/g, ""),
      items:          items || "",
      auth_code:      authCode,
      return_code:    cardData.status || "",
    });

    return res.status(200).json({
      kind,
      payment_id:         paymentId,
      status:             approved ? "approved" : "declined",
      authorization_code: authCode,
      message:            cardData.status,
    });

  } catch (err) {
    console.error("Erro checkout Getnet:", err);
    return res.status(500).json({ error: err.message });
  }
}

/* detecta bandeira pelo número */
function detectBrand(num) {
  const n = num.replace(/\s/g, "");
  if (/^4/.test(n))                return "Visa";
  if (/^5[1-5]/.test(n))          return "Mastercard";
  if (/^3[47]/.test(n))           return "Amex";
  if (/^(606282|3841)/.test(n))   return "Hipercard";
  if (/^(6362|438935|504175|451416|636297|5067|4576|4011)/.test(n)) return "Elo";
  return "Mastercard"; // fallback
}
