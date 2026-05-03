// ================================================================
// api/status-getnet.js — Consulta status de pagamento Getnet
// ================================================================
// Uso: GET /api/status-getnet?payment_id=XXXX
// ================================================================

const GETNET_CLIENT_ID     = process.env.GETNET_CLIENT_ID     || "sbx_0b70ae43-b638-4f02-9e50-fe16ae0c571a";
const GETNET_CLIENT_SECRET = process.env.GETNET_CLIENT_SECRET || "5c90c3f7-e435-482b-902e-dfb9d1585aab";
const GETNET_SELLER_ID     = process.env.GETNET_SELLER_ID     || "192ec5f4-31af-4652-aecc-ea1032a38f37";
const GETNET_SANDBOX       = process.env.GETNET_SANDBOX !== "false";

const GETNET_URL = GETNET_SANDBOX
  ? "https://api-sbx.globalgetnet.com"
  : "https://api.globalgetnet.com";

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
  if (!res.ok) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido" });

  const { payment_id } = req.query;
  if (!payment_id) return res.status(400).json({ error: "payment_id não informado" });

  try {
    const token = await getToken();

    const response = await fetch(`${GETNET_URL}/v1/payments/credit/${payment_id}`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "seller_id": GETNET_SELLER_ID,
      },
    });

    const data = await response.json();
    if (!response.ok) throw new Error(`Pagamento não encontrado: ${JSON.stringify(data)}`);

    return res.status(200).json({
      payment_id:        data.payment_id,
      status:            data.status === "APPROVED" ? "approved" : data.status?.toLowerCase() || "unknown",
      authorization_code: data.credit?.authorization_code || data.debit?.authorization_code || "",
      amount:            data.amount,
      installments:      data.credit?.number_installments || 1,
    });

  } catch (err) {
    console.error("Erro status Getnet:", err);
    return res.status(500).json({ error: err.message });
  }
}
