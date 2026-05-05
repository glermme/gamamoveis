// ================================================================
// api/webhook-getnet.js — Recebe notificações da Getnet
// ================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";

async function updateOrder(paymentId, status) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn("Supabase não configurado, pulando atualização.");
    return;
  }
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pedidos?tid=eq.${paymentId}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ status }),
      }
    );
    const data = await res.json();
    console.log("Supabase update:", JSON.stringify(data));
  } catch (err) {
    console.error("Erro ao atualizar Supabase:", err);
  }
}

module.exports = async function handler(req, res) {
  // GET: ping de validação da Getnet
  if (req.method === "GET") {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const event = req.body;
    console.log("Webhook Getnet recebido:", JSON.stringify(event, null, 2));

    // A Getnet pode mandar o payment_id direto ou dentro de objetos aninhados
    const paymentId =
      event.payment_id ||
      (event.credit && event.credit.payment_id) ||
      (event.debit && event.debit.payment_id) ||
      (event.pix && event.pix.payment_id) ||
      null;

    const status = event.status || null;

    if (paymentId && status) {
      const normalized =
        status === "APPROVED" || status === "PAID" || status === "CONFIRMED"
          ? "approved"
          : status === "CANCELED" || status === "DENIED"
          ? "declined"
          : "pending";

      await updateOrder(paymentId, normalized);
      console.log(`Pedido ${paymentId} → ${normalized}`);
    } else {
      console.warn("Webhook sem payment_id ou status:", JSON.stringify(event));
    }

    // Getnet espera 200 para não retentar
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Erro webhook Getnet:", err);
    return res.status(500).json({ error: "Erro interno" });
  }
};
