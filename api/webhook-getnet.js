// ================================================================
// api/webhook-getnet.js — Recebe notificações da Getnet
// ================================================================
// Configure a URL no painel Getnet → Webhooks:
//   https://seudominio.com.br/api/webhook-getnet
// ================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";

async function updateOrder(paymentId, status) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/pedidos?tid=eq.${paymentId}`, {
      method: "PATCH",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status }),
    });
  } catch (err) {
    console.error("Erro ao atualizar Supabase:", err);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

  try {
    const event = req.body;
    console.log("Webhook Getnet:", JSON.stringify(event, null, 2));

    const paymentId = event.payment_id;
    const status    = event.status;

    if (paymentId && status) {
      const normalized = status === "APPROVED" ? "approved"
        : status === "CANCELED" ? "declined"
        : "pending";

      await updateOrder(paymentId, normalized);
      console.log(`✅ Pedido ${paymentId} → ${normalized}`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Erro webhook Getnet:", err);
    return res.status(500).json({ error: "Erro interno" });
  }
}
