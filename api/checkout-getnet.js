// ================================================================
// api/checkout-getnet.js — Processa pagamentos via Getnet
// ================================================================

const GETNET_CLIENT_ID = process.env.GETNET_CLIENT_ID;
const GETNET_CLIENT_SECRET = process.env.GETNET_CLIENT_SECRET;
const GETNET_SELLER_ID = process.env.GETNET_SELLER_ID;
const GETNET_SANDBOX = process.env.GETNET_SANDBOX === "true";

if (!GETNET_CLIENT_ID || !GETNET_CLIENT_SECRET || !GETNET_SELLER_ID) {
  throw new Error("Variáveis da Getnet não configuradas");
}

const GETNET_URL = GETNET_SANDBOX
  ? "https://api-sandbox.getnet.com.br"
  : "https://api.getnet.com.br";

// Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";

/* ───────────────────────────────────────────── */
/* TOKEN                                        */
/* ───────────────────────────────────────────── */

async function getToken() {
  const credentials = Buffer.from(
    `${GETNET_CLIENT_ID}:${GETNET_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(`${GETNET_URL}/auth/oauth/v2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=oob",
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      `Erro ao obter token: ${JSON.stringify(data)}`
    );
  }

  return data.access_token;
}

/* ───────────────────────────────────────────── */
/* TOKENIZA CARTÃO                              */
/* ───────────────────────────────────────────── */

async function tokenizeCard(token, cardNumber, customerId) {
  const res = await fetch(`${GETNET_URL}/v1/tokens/card`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      seller_id: GETNET_SELLER_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      card_number: cardNumber.replace(/\s/g, ""),
      customer_id: customerId,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      `Erro ao tokenizar cartão: ${JSON.stringify(data)}`
    );
  }

  return data.number_token;
}

/* ───────────────────────────────────────────── */
/* SALVA NO SUPABASE                            */
/* ───────────────────────────────────────────── */

async function saveOrder(order) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/pedidos`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(order),
    });
  } catch (err) {
    console.error("Erro ao salvar pedido:", err);
  }
}

/* ───────────────────────────────────────────── */
/* HANDLER                                      */
/* ───────────────────────────────────────────── */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método não permitido",
    });
  }

  try {
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
      kind,
      reference,
      items,
    } = req.body;

    const accessToken = await getToken();

    const orderId = reference || `GAMA-${Date.now()}`;
    const customerId = `customer-${customerCpf.replace(/\D/g, "")}`;
    const amountNum = Number(amount);

    /* ───────────────── PIX ───────────────── */

    if (kind === "pix") {
      const pixBody = {
        seller_id: GETNET_SELLER_ID,
        amount: amountNum,
        currency: "BRL",
        order: {
          order_id: orderId,
        },
        customer: {
          customer_id: customerId,
          first_name: customerName.split(" ")[0],
          last_name:
            customerName.split(" ").slice(1).join(" ") || ".",
          email: customerEmail,
          document_type: "CPF",
          document_number: customerCpf.replace(/\D/g, ""),
          phone_number: customerPhone.replace(/\D/g, ""),
        },
      };

      const pixRes = await fetch(
        `${GETNET_URL}/v1/payments/pix`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            seller_id: GETNET_SELLER_ID,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(pixBody),
        }
      );

      const pixData = await pixRes.json();

      if (!pixRes.ok) {
        throw new Error(`Erro Pix: ${JSON.stringify(pixData)}`);
      }

      await saveOrder({
        tid: pixData.payment_id || orderId,
        reference: orderId,
        status: "pending",
        kind: "pix",
        amount: amountNum,
        installments: 1,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_cpf: customerCpf.replace(/\D/g, ""),
        items: items || "",
      });

      return res.status(200).json({
        kind: "pix",
        payment_id: pixData.payment_id,
        qrCode: pixData.qr_code,
        status: "pending",
      });
    }

    /* ──────────────── CARTÃO ─────────────── */

    const [expMonth, expYearRaw] = (cardExpiry || "").split("/");
    const expYear = expYearRaw.slice(-2);

    const numberToken = await tokenizeCard(
      accessToken,
      cardNumber,
      customerId
    );

    const endpoint =
      kind === "debit"
        ? "/v1/payments/debit"
        : "/v1/payments/credit";

    const paymentBody = {
      seller_id: GETNET_SELLER_ID,
      amount: amountNum,
      currency: "BRL",

      order: {
        order_id: orderId,
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
        document_number: customerCpf.replace(/\D/g, ""),
        phone_number: customerPhone.replace(/\D/g, ""),
      },

      device: {
        device_id: `device-${Date.now()}`,
        ip_address:
          req.headers["x-forwarded-for"] || "127.0.0.1",
      },

      [kind === "debit" ? "debit" : "credit"]: {
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
          security_code: cardCvv,
          brand: detectBrand(cardNumber),
          expiration_month: expMonth,
          expiration_year: expYear,
        },
      },
    };

    const paymentRes = await fetch(
      `${GETNET_URL}${endpoint}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          seller_id: GETNET_SELLER_ID,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(paymentBody),
      }
    );

    const paymentData = await paymentRes.json();

    if (!paymentRes.ok) {
      throw new Error(
        `Erro pagamento: ${JSON.stringify(paymentData)}`
      );
    }

    const approved = paymentData.status === "APPROVED";

    await saveOrder({
      tid: paymentData.payment_id || orderId,
      reference: orderId,
      status: approved ? "approved" : "declined",
      kind,
      amount: amountNum,
      installments: Number(installments) || 1,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_cpf: customerCpf.replace(/\D/g, ""),
      items: items || "",
      return_code: paymentData.status || "",
    });

    return res.status(200).json({
      payment_id: paymentData.payment_id,
      status: approved ? "approved" : "declined",
      raw_status: paymentData.status,
    });
  } catch (err) {
    console.error("Erro checkout Getnet:", err);

    return res.status(500).json({
      error: err.message,
    });
  }
}

/* ───────────────────────────────────────────── */
/* DETECTA BANDEIRA                             */
/* ───────────────────────────────────────────── */

function detectBrand(num) {
  const n = num.replace(/\s/g, "");

  if (/^4/.test(n)) return "Visa";
  if (/^5[1-5]/.test(n)) return "Mastercard";
  if (/^3[47]/.test(n)) return "Amex";
  if (/^(606282|3841)/.test(n)) return "Hipercard";

  if (
    /^(6362|438935|504175|451416|636297|5067|4576|4011)/.test(n)
  ) {
    return "Elo";
  }

  return "Mastercard";
}
