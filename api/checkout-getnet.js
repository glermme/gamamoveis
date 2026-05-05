// ================================================================
// api/status-getnet.js
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
    throw new Error(JSON.stringify(data));
  }

  return data.access_token;
}

/* ───────────────────────────────────────────── */
/* HANDLER                                      */
/* ───────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  try {
    const { payment_id, kind } = req.query;

    if (!payment_id || !payment_id.trim()) {
      return res.status(400).json({ error: "payment_id nao informado" });
    }

    // Rota correta por tipo de pagamento
    const routeMap = {
      credit: `/v1/payments/credit/${payment_id.trim()}`,
      debit:  `/v1/payments/debit/${payment_id.trim()}`,
      pix:    `/v1/payments/qrcode/pix/${payment_id.trim()}`,
    };

    const route = routeMap[kind] || routeMap["credit"];
    console.log("STATUS ROUTE:", route);

    const token = await getToken();

    const response = await fetch(`${GETNET_URL}${route}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-seller-id": GETNET_SELLER_ID,
        Accept: "application/json",
      },
    });

    const rawText = await response.text();
    console.log("RESPOSTA GETNET RAW:", rawText);

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (_) {
      throw new Error("Getnet retornou resposta nao-JSON: " + rawText.slice(0, 200));
    }

    return res.status(response.ok ? 200 : response.status).json(data);
  } catch (err) {
    console.error("[status-getnet] Erro:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
