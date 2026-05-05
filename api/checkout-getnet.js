// ================================================================
// api/checkout-getnet.js
// ================================================================

const GETNET_CLIENT_ID = process.env.GETNET_CLIENT_ID;
const GETNET_CLIENT_SECRET = process.env.GETNET_CLIENT_SECRET;
const GETNET_SELLER_ID = process.env.GETNET_SELLER_ID;

const GETNET_URL = "https://api.getnet.com.br";

/* ───────────────────────────────────────────── */
/* TOKEN                                        */
/* ───────────────────────────────────────────── */

async function getToken() {
  const credentials = Buffer.from(
    `${GETNET_CLIENT_ID}:${GETNET_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch(
    `${GETNET_URL}/auth/oauth/v2/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=oob",
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data.access_token;
}

/* ───────────────────────────────────────────── */
/* TOKENIZA CARTÃO                              */
/* ───────────────────────────────────────────── */

async function tokenizeCard(token, cardNumber, customerId) {
  // Remove TUDO que não for dígito (espaços, traços, espaços não-quebráveis, etc.)
  const cleanNumber = String(cardNumber).replace(/\D/g, "");

  if (!cleanNumber || cleanNumber.length < 13 || cleanNumber.length > 19) {
    throw new Error(
      `Número de cartão inválido: "${cardNumber}" → "${cleanNumber}"`
    );
  }

  const response = await fetch(`${GETNET_URL}/v1/tokens/card`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-seller-id": GETNET_SELLER_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      card_number: cleanNumber,
      customer_id: customerId,
    }),
  });

  const data = await response.json();

  console.log("TOKEN RESPONSE:", JSON.stringify(data));
  console.log("NUMBER TOKEN LENGTH:", data.number_token?.length);

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data.number_token;
}

/* ───────────────────────────────────────────── */
/* HANDLER                                      */
/* ───────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  try {
    // ── DEBUG: variáveis de ambiente ──────────
    console.log("ENV CHECK:", {
      clientId: process.env.GETNET_CLIENT_ID ? "OK" : "FALTANDO",
      secret: process.env.GETNET_CLIENT_SECRET ? "OK" : "FALTANDO",
      sellerId: process.env.GETNET_SELLER_ID ? "OK" : "FALTANDO",
      url: GETNET_URL,
    });

    const {
      amount,
      installments,
      cardNumber,
      cardExpiry,
      cardCvv,
      cardHolder,
      customerName,
      customerCpf,
      customerEmail,
      customerPhone,
    } = req.body;

    // ── Validações de entrada ──────────────────
    if (!cardNumber || String(cardNumber).replace(/\D/g, "").length < 13) {
      return res.status(400).json({ error: "Número de cartão inválido" });
    }
    if (!cardExpiry || !cardExpiry.includes("/")) {
      return res.status(400).json({ error: "Validade do cartão inválida" });
    }
    if (!cardCvv) {
      return res.status(400).json({ error: "CVV não informado" });
    }
    if (!customerCpf) {
      return res.status(400).json({ error: "CPF não informado" });
    }
    if (!amount || isNaN(Number(amount))) {
      return res.status(400).json({ error: "Valor inválido" });
    }

    // ── Token Getnet ───────────────────────────
    const token = await getToken();

    const customerId = "customer-" + String(customerCpf).replace(/\D/g, "");

    const numberToken = await tokenizeCard(token, cardNumber, customerId);

    // ── Validade ───────────────────────────────
    const [month, yearRaw] = cardExpiry.split("/");
    const year = String(yearRaw).trim().slice(-2);

    // ── Body do pagamento ──────────────────────
    const paymentBody = {
      seller_id: GETNET_SELLER_ID,

      amount: Number(amount),

      currency: "BRL",

      order: {
        order_id: `GAMA-${Date.now()}`,
        sales_tax: 0,
        product_type: "service",
      },

      customer: {
        customer_id: customerId,

        first_name: customerName.split(" ")[0],

        last_name:
          customerName.split(" ").slice(1).join(" ") || ".",

        email: customerEmail,

        document_type: "CPF",

        document_number: String(customerCpf).replace(/\D/g, ""),

        phone_number: String(customerPhone).replace(/\D/g, ""),
      },

      device: {
        device_id: "device-" + Date.now(),

        ip_address:
          req.headers["x-forwarded-for"] || "127.0.0.1",
      },

      credit: {
        delayed: false,

        authenticated: false,

        pre_authorization: false,

        save_card_data: false,

        transaction_type: "FULL",

        number_installments: Number(installments) || 1,

        soft_descriptor: "GAMA MOVEIS",

        card: {
          number_token: numberToken,

          cardholder_name: cardHolder,

          security_code: String(cardCvv).replace(/\D/g, ""),

          brand: detectBrand(cardNumber),

          expiration_month: month.trim(),

          expiration_year: year,
        },
      },
    };

    // ── DEBUG: body que será enviado à Getnet ──
    console.log("PAYMENT CARD:", JSON.stringify(paymentBody.credit.card));
    console.log("PAYMENT CUSTOMER:", JSON.stringify(paymentBody.customer));

    const response = await fetch(`${GETNET_URL}/v1/payments/credit`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-seller-id": GETNET_SELLER_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paymentBody),
    });

    const rawText = await response.text();
    console.log("RESPOSTA GETNET RAW:", rawText);

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error("Getnet retornou resposta não-JSON: " + rawText.slice(0, 200));
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("[checkout-getnet] Erro:", err.message);

    return res.status(500).json({ error: err.message });
  }
}

/* ───────────────────────────────────────────── */
/* DETECTA BANDEIRA                             */
/* ───────────────────────────────────────────── */

function detectBrand(num) {
  const n = String(num).replace(/\D/g, "");

  if (/^4/.test(n)) return "Visa";

  if (/^5[1-5]/.test(n)) return "Mastercard";

  // Mastercard faixas novas (2017+): 222100–272099
  if (/^2(2[2-9][1-9]|[3-6]\d{2}|7[01]\d|720)\d/.test(n))
    return "Mastercard";

  if (/^3[47]/.test(n)) return "Amex";

  if (
    /^(6362|438935|504175|451416|636297|5067|4576|4011)/.test(n)
  )
    return "Elo";

  if (/^606282/.test(n)) return "Hipercard";

  return "Mastercard"; // fallback
}
