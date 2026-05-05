// ================================================================
// api/status-getnet.js
// ================================================================

const GETNET_CLIENT_ID = process.env.GETNET_CLIENT_ID;
const GETNET_CLIENT_SECRET = process.env.GETNET_CLIENT_SECRET;
const GETNET_SELLER_ID = process.env.GETNET_SELLER_ID;

const GETNET_URL = "https://api.getnet.com.br";

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
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data.access_token;
}

module.exports = async function handler(req, res) {
  try {
    const { payment_id, kind } = req.query;

    if (!payment_id || !payment_id.trim()) {
      return res.status(400).json({ error: "payment_id nao informado" });
    }

    const token = await getToken();

    // Rota generica da Getnet funciona para todos os tipos
    const route = kind === "pix"
      ? `/v1/payments/qrcode/${payment_id.trim()}`
      : kind === "debit"
      ? `/v1/payments/debit/${payment_id.trim()}`
      : `/v1/payments/credit/${payment_id.trim()}`;

    console.log("STATUS ROUTE:", route);

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
    try { data = JSON.parse(rawText); }
    catch (_) { throw new Error("Resposta nao-JSON: " + rawText.slice(0, 200)); }

    return res.status(response.ok ? 200 : response.status).json(data);
  } catch (err) {
    console.error("[status-getnet] Erro:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
