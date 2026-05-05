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

  const response = await fetch(`${GETNET_URL}/auth/oauth/v2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=oob",
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error("Falha ao obter token: " + JSON.stringify(data));
  }

  return data.access_token;
}

/* ───────────────────────────────────────────── */
/* TOKENIZA CARTÃO                              */
/* ───────────────────────────────────────────── */

async function tokenizeCard(token, cardNumber, customerId) {
  const cleanNumber = String(cardNumber).replace(/\D/g, "");

  if (!cleanNumber || cleanNumber.length < 13 || cleanNumber.length > 19) {
    throw new Error(
      `Número de cartão inválido: "${cardNumber}" -> "${cleanNumber}"`
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

  if (!response.ok) {
    throw new Error("Falha ao tokenizar cartão: " + JSON.stringify(data));
  }

  return data.number_token;
}

/* ───────────────────────────────────────────── */
/* HELPER: fetch com resposta segura            */
/* ───────────────────────────────────────────── */

async function getnetFetch(url, options) {
  const response = await fetch(url, options);
  const rawText = await response.text();

  let data;
  try {
    data = JSON.parse(rawText);
  } catch (_) {
    throw new Error(
      "Getnet retornou resposta nao-JSON: " + rawText.slice(0, 300)
    );
  }

  console.log("GETNET RESPONSE:", JSON.stringify(data));
  return { response, data };
}

/* ───────────────────────────────────────────── */
/* HANDLER                                      */
/* ───────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  try {
    console.log("BODY RECEBIDO:", JSON.stringify(req.body));

    const {
      kind,
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
      reference,
    } = req.body;

    // -- Validacoes comuns ----------------------
    if (!kind || !["credit", "debit", "pix"].includes(kind)) {
      return res.status(400).json({ error: "Tipo de pagamento invalido" });
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ error: "Valor invalido" });
    }
    if (!customerCpf) {
      return res.status(400).json({ error: "CPF nao informado" });
    }
    if (!customerName) {
      return res.status(400).json({ error: "Nome nao informado" });
    }

    // -- Validacoes de cartao (credito/debito) --
    if (kind !== "pix") {
      if (!cardNumber || String(cardNumber).replace(/\D/g, "").length < 13) {
        return res.status(400).json({ error: "Numero de cartao invalido" });
      }
      if (!cardExpiry || !cardExpiry.includes("/")) {
        return res.status(400).json({ error: "Validade do cartao invalida" });
      }
      if (!cardCvv) {
        return res.status(400).json({ error: "CVV nao informado" });
      }
      if (!cardHolder || cardHolder.trim().length < 3) {
        return res.status(400).json({ error: "Nome do titular invalido" });
      }
    }

    // -- Token Getnet ---------------------------
    const token = await getToken();

    const customerId = "customer-" + String(customerCpf).replace(/\D/g, "");
    const orderId = reference || `GAMA-${Date.now()}`;
    const amountNum = Number(amount);

    const nameParts = customerName.trim().split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ") || ".";

    const customerObj = {
      customer_id: customerId,
      first_name: firstName,
      last_name: lastName,
      email: customerEmail,
      document_type: "CPF",
      document_number: String(customerCpf).replace(/\D/g, ""),
      phone_number: String(customerPhone).replace(/\D/g, ""),
    };

    const deviceObj = {
      device_id: "device-" + Date.now(),
      ip_address: req.headers["x-forwarded-for"] || "127.0.0.1",
    };

    const orderObj = {
      order_id: orderId,
      sales_tax: 0,
      product_type: "service",
    };

    /* -- PIX ----------------------------------- */
    if (kind === "pix") {
      const pixBody = {
        seller_id: GETNET_SELLER_ID,
        amount: amountNum,
        currency: "BRL",
        order: orderObj,
        customer: customerObj,
        device: deviceObj,
        pix: {
          expiration_time: 3600,
          additional_data: [
            { name: "Loja", value: "Gama Moveis" },
          ],
        },
      };

      console.log("PIX BODY:", JSON.stringify(pixBody));

      const { data } = await getnetFetch(
        `${GETNET_URL}/v1/payments/qrcode/pix`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "x-seller-id": GETNET_SELLER_ID,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(pixBody),
        }
      );

      return res.status(200).json(data);
    }

    /* -- CARTAO (credito ou debito) ------------ */
    const [month, yearRaw] = cardExpiry.split("/");
    const year = String(yearRaw).trim().slice(-2);

    const numberToken = await tokenizeCard(token, cardNumber, customerId);

    const cardObj = {
      number_token: numberToken,
      cardholder_name: cardHolder.trim(),
      security_code: String(cardCvv).replace(/\D/g, ""),
      brand: detectBrand(cardNumber),
      expiration_month: month.trim(),
      expiration_year: year,
    };

    /* -- CREDITO -------------------------------- */
    if (kind === "credit") {
      const creditBody = {
        seller_id: GETNET_SELLER_ID,
        amount: amountNum,
        currency: "BRL",
        order: orderObj,
        customer: customerObj,
        device: deviceObj,
        credit: {
          delayed: false,
          authenticated: false,
          pre_authorization: false,
          save_card_data: false,
          transaction_type: "FULL",
          number_installments: Number(installments) || 1,
          soft_descriptor: "GAMA MOVEIS",
          card: cardObj,
        },
      };

      console.log("CREDIT BODY:", JSON.stringify(creditBody));

      const { data } = await getnetFetch(
        `${GETNET_URL}/v1/payments/credit`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "x-seller-id": GETNET_SELLER_ID,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(creditBody),
        }
      );

      return res.status(200).json(data);
    }

    /* -- DEBITO --------------------------------- */
    if (kind === "debit") {
      const debitBody = {
        seller_id: GETNET_SELLER_ID,
        amount: amountNum,
        currency: "BRL",
        order: orderObj,
        customer: customerObj,
        device: deviceObj,
        debit: {
          authenticated: false,
          transaction_type: "FULL",
          soft_descriptor: "GAMA MOVEIS",
          card: cardObj,
        },
      };

      console.log("DEBIT BODY:", JSON.stringify(debitBody));

      const { data } = await getnetFetch(
        `${GETNET_URL}/v1/payments/debit`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "x-seller-id": GETNET_SELLER_ID,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(debitBody),
        }
      );

      return res.status(200).json(data);
    }
  } catch (err) {
    console.error("[checkout-getnet] Erro:", err.message);
    return res.status(500).json({ error: err.message });
  }
};

/* ───────────────────────────────────────────── */
/* DETECTA BANDEIRA                             */
/* ───────────────────────────────────────────── */

function detectBrand(num) {
  const n = String(num).replace(/\D/g, "");

  if (/^4/.test(n)) return "Visa";
  if (/^5[1-5]/.test(n)) return "Mastercard";
  if (/^2(2[2-9][1-9]|[3-6]\d{2}|7[01]\d|720)\d/.test(n)) return "Mastercard";
  if (/^3[47]/.test(n)) return "Amex";
  if (/^(6362|438935|504175|451416|636297|5067|4576|4011)/.test(n)) return "Elo";
  if (/^606282/.test(n)) return "Hipercard";

  return "Mastercard";
}
