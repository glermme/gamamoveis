// ================================================================
// api/status-getnet.js — Consulta status de pagamento Getnet
// ================================================================

const GETNET_CLIENT_ID = process.env.GETNET_CLIENT_ID;
const GETNET_CLIENT_SECRET = process.env.GETNET_CLIENT_SECRET;
const GETNET_SELLER_ID = process.env.GETNET_SELLER_ID;
const GETNET_SANDBOX = process.env.GETNET_SANDBOX !== "false";

if (!GETNET_CLIENT_ID || !GETNET_CLIENT_SECRET || !GETNET_SELLER_ID) {
  throw new Error("Variáveis da Getnet não configuradas");
}

const GETNET_URL = GETNET_SANDBOX
  ? "https://api-sbx.globalgetnet.com"
  : "https://api.getnet.com.br";

/* ───────────────────────────────────────────── */
/* TOKEN                                        */
/* ───────────────────────────────────────────── */

async function getToken() {
  const tokenPath = GETNET_SANDBOX
    ? "/authentication/oauth2/access_token"
    : "/auth/oauth/v2/token";

  const credentials = Buffer.from(
    `${GETNET_CLIENT_ID}:${GETNET_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(`${GETNET_URL}${tokenPath}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: GETNET_SANDBOX
      ? "grant_type=client_credentials"
      : "grant_type=client_credentials&scope=oob",
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
/* HANDLER                                      */
/* ───────────────────────────────────────────── */

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Método não permitido",
    });
  }

  const { payment_id } = req.query;

  if (!payment_id) {
    return res.status(400).json({
      error: "payment_id não informado",
    });
  }

  try {
    const token = await getToken();

    const endpoint = GETNET_SANDBOX
      ? `${GETNET_URL}/v1/payments/${payment_id}`
      : `${GETNET_URL}/v1/payments/credit/${payment_id}`;

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(GETNET_SANDBOX
          ? { "x-seller-id": GETNET_SELLER_ID }
          : { seller_id: GETNET_SELLER_ID }),
        Accept: "application/json",
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        `Pagamento não encontrado: ${JSON.stringify(data)}`
      );
    }

    return res.status(200).json({
      payment_id: data.payment_id,
      status:
        data.status === "APPROVED" ||
        data.status === "AUTHORIZED"
          ? "approved"
          : data.status?.toLowerCase() || "unknown",

      authorization_code:
        data.authorization_code ||
        data.credit?.authorization_code ||
        data.debit?.authorization_code ||
        "",

      amount: data.amount,
      installments:
        data.credit?.number_installments || 1,

      raw_status: data.status,
    });
  } catch (err) {
    console.error("Erro status Getnet:", err);

    return res.status(500).json({
      error: err.message,
    });
  }
}
