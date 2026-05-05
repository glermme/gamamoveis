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
/* HANDLER                                      */
/* ───────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  try {
    const { payment_id } = req.query;

    if (!payment_id || typeof payment_id !== "string" || !payment_id.trim()) {
      return res.status(400).json({ error: "payment_id não informado" });
    }

    const token = await getToken();

    const response = await fetch(
      `${GETNET_URL}/v1/payments/credit/${payment_id.trim()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "x-seller-id": GETNET_SELLER_ID,
          Accept: "application/json",
        },
      }
    );

    const data = await response.json();

    return res.status(response.ok ? 200 : response.status).json(data);
  } catch (err) {
    console.error("[status-getnet] Erro:", err.message);

    return res.status(500).json({ error: err.message });
  }
}
