// ================================================================
// api/checkout-getnet.js
// ================================================================

const GETNET_CLIENT_ID  = process.env.GETNET_CLIENT_ID;
const GETNET_CLIENT_SECRET = process.env.GETNET_CLIENT_SECRET;
const GETNET_SELLER_ID  = process.env.GETNET_SELLER_ID;
const SUPABASE_URL      = process.env.SUPABASE_URL || "";
const SUPABASE_KEY      = process.env.SUPABASE_KEY || "";

const GETNET_URL = "https://api.getnet.com.br";

/* ───────────────────────────────────────────── */
/* SUPABASE: insere pedido                      */
/* ───────────────────────────────────────────── */

async function insertOrder(row) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn("Supabase nao configurado, pulando insert.");
    return;
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pedidos`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error("Supabase insert erro:", txt);
    } else {
      console.log("Supabase insert OK:", row.tid);
    }
  } catch (err) {
    console.error("Supabase insert exception:", err.message);
  }
}

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
  if (!response.ok) throw new Error("Falha ao obter token: " + JSON.stringify(data));
  return data.access_token;
}

/* ───────────────────────────────────────────── */
/* TOKENIZA CARTAO                              */
/* ───────────────────────────────────────────── */

async function tokenizeCard(token, cardNumber, customerId) {
  const cleanNumber = String(cardNumber).replace(/\D/g, "");

  if (!cleanNumber || cleanNumber.length < 13 || cleanNumber.length > 19) {
    throw new Error(`Numero de cartao invalido: "${cardNumber}" -> "${cleanNumber}"`);
  }

  const response = await fetch(`${GETNET_URL}/v1/tokens/card`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-seller-id": GETNET_SELLER_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ card_number: cleanNumber, customer_id: customerId }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error("Falha ao tokenizar cartao: " + JSON.stringify(data));
  return data.number_token;
}

/* ───────────────────────────────────────────── */
/* HELPER: fetch seguro                         */
/* ───────────────────────────────────────────── */

async function getnetFetch(url, options) {
  const response = await fetch(url, options);
  const rawText  = await response.text();

  let data;
  try { data = JSON.parse(rawText); }
  catch (_) { throw new Error("Getnet retornou nao-JSON: " + rawText.slice(0, 300)); }

  console.log("GETNET RESPONSE:", JSON.stringify(data));
  return { response, data };
}

/* ───────────────────────────────────────────── */
/* HANDLER                                      */
/* ───────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  try {
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
      addrStreet,
      addrNumber,
      addrComplement,
      addrDistrict,
      addrCity,
      addrState,
      addrZip,
      reference,
      items,
    } = req.body;

    // -- Validacoes comuns ----------------------
    if (!kind || !["credit", "debit", "pix"].includes(kind))
      return res.status(400).json({ error: "Tipo de pagamento invalido" });
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0)
      return res.status(400).json({ error: "Valor invalido" });
    if (!customerCpf)
      return res.status(400).json({ error: "CPF nao informado" });
    if (!customerName)
      return res.status(400).json({ error: "Nome nao informado" });

    // -- Validacoes de cartao -------------------
    if (kind !== "pix") {
      if (!cardNumber || String(cardNumber).replace(/\D/g, "").length < 13)
        return res.status(400).json({ error: "Numero de cartao invalido" });
      if (!cardExpiry || !cardExpiry.includes("/"))
        return res.status(400).json({ error: "Validade do cartao invalida" });
      if (!cardCvv)
        return res.status(400).json({ error: "CVV nao informado" });
      if (!cardHolder || cardHolder.trim().length < 3)
        return res.status(400).json({ error: "Nome do titular invalido" });
    }

    // -- Prepara dados --------------------------
    const token      = await getToken();
    const customerId = "customer-" + String(customerCpf).replace(/\D/g, "");
    const orderId    = reference || `GAMA-${Date.now()}`;
    const amountNum  = Number(amount);

    const nameParts = customerName.trim().split(" ");
    const customerObj = {
      customer_id:     customerId,
      first_name:      nameParts[0],
      last_name:       nameParts.slice(1).join(" ") || ".",
      name:            customerName.trim(),
      email:           customerEmail,
      document_type:   "CPF",
      document_number: String(customerCpf).replace(/\D/g, ""),
      phone_number:    String(customerPhone).replace(/\D/g, ""),
      billing_address: {
        street:      addrStreet || "",
        number:      addrNumber || "",
        complement:  addrComplement || "",
        district:    addrDistrict || "",
        city:        addrCity || "",
        state:       addrState || "",
        country:     "Brasil",
        postal_code: String(addrZip || "").replace(/\D/g, ""),
      },
    };

    const deviceObj = {
      device_id:  "device-" + Date.now(),
      ip_address: req.headers["x-forwarded-for"] || "127.0.0.1",
    };

    const orderObj = { order_id: orderId, sales_tax: 0, product_type: "service" };

    // Linha base do pedido para o Supabase
    const baseRow = {
      reference:      orderId,
      kind,
      amount:         amountNum,
      installments:   Number(installments) || 1,
      customer_name:  customerName,
      customer_email: customerEmail,
      customer_cpf:   String(customerCpf).replace(/\D/g, ""),
      items:          items || "",
      status:         "pending",
    };

    /* -- PIX ----------------------------------- */
    if (kind === "pix") {
      const { data } = await getnetFetch(
        `${GETNET_URL}/v1/payments/qrcode/pix`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "x-seller-id": GETNET_SELLER_ID,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            seller_id: GETNET_SELLER_ID,
            amount:    amountNum,
            currency:  "BRL",
            order:     orderObj,
            customer:  customerObj,
            device:    deviceObj,
            pix: {
              expiration_time:  3600,
              additional_data: [{ name: "Loja", value: "Gama Moveis" }],
            },
          }),
        }
      );

      // Salva pedido no Supabase
      await insertOrder({ ...baseRow, tid: data.payment_id || null, status: "pending" });

      return res.status(200).json(data);
    }

    /* -- CARTAO -------------------------------- */
    const [month, yearRaw] = cardExpiry.split("/");
    const year = String(yearRaw).trim().slice(-2);
    const numberToken = await tokenizeCard(token, cardNumber, customerId);

    const cardObj = {
      number_token:    numberToken,
      cardholder_name: cardHolder.trim(),
      security_code:   String(cardCvv).replace(/\D/g, ""),
      brand:           detectBrand(cardNumber),
      expiration_month: month.trim(),
      expiration_year:  year,
    };

    const cardHeaders = {
      Authorization: `Bearer ${token}`,
      "x-seller-id": GETNET_SELLER_ID,
      "Content-Type": "application/json",
    };

    /* -- CREDITO ------------------------------- */
    if (kind === "credit") {
      const { data } = await getnetFetch(
        `${GETNET_URL}/v1/payments/credit`,
        {
          method: "POST",
          headers: cardHeaders,
          body: JSON.stringify({
            seller_id: GETNET_SELLER_ID,
            amount:    amountNum,
            currency:  "BRL",
            order:     orderObj,
            customer:  customerObj,
            device:    deviceObj,
            credit: {
              delayed:           false,
              authenticated:     false,
              pre_authorization: false,
              save_card_data:    false,
              transaction_type:  "FULL",
              number_installments: Number(installments) || 1,
              soft_descriptor:   "GAMA MOVEIS",
              dynamic_mcc:       1799,
              card:              cardObj,
            },
          }),
        }
      );

      const status     = data.status === "APPROVED" ? "approved" : "pending";
      const authCode   = data.credit?.authorization_code || data.authorization_code || "";
      const returnCode = data.credit?.terminal_nsu || data.terminal_nsu || "";

      await insertOrder({
        ...baseRow,
        tid:         data.payment_id || null,
        status,
        auth_code:   authCode,
        return_code: returnCode,
      });

      return res.status(200).json(data);
    }

    /* -- DEBITO -------------------------------- */
    if (kind === "debit") {
      const { data } = await getnetFetch(
        `${GETNET_URL}/v1/payments/debit`,
        {
          method: "POST",
          headers: cardHeaders,
          body: JSON.stringify({
            seller_id: GETNET_SELLER_ID,
            amount:    amountNum,
            currency:  "BRL",
            order:     orderObj,
            customer:  customerObj,
            device:    deviceObj,
            debit: {
              authenticated:    false,
              transaction_type: "FULL",
              soft_descriptor:  "GAMA MOVEIS",
              card:             cardObj,
            },
          }),
        }
      );

      const status     = data.status === "APPROVED" ? "approved" : "pending";
      const authCode   = data.debit?.authorization_code || data.authorization_code || "";
      const returnCode = data.debit?.terminal_nsu || data.terminal_nsu || "";

      await insertOrder({
        ...baseRow,
        tid:         data.payment_id || null,
        status,
        auth_code:   authCode,
        return_code: returnCode,
      });

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
