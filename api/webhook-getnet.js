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
  try {
    // A Getnet envia PIX como GET com query params
    // e outros pagamentos como POST com body JSON
    const isGet = req.method === "GET";
    const event = isGet ? req.query : req.body;

    console.log("Webhook Getnet recebido:", req.method, JSON.stringify(event, null, 2));

    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ error: "Método não permitido" });
    }

    const paymentId =
      event.payment_id ||
      (event.credit && event.credit.payment_id) ||
      (event.debit  && event.debit.payment_id)  ||
      (event.pix    && event.pix.payment_id)    || null;

    const status = event.status || null;

    if (paymentId && status) {
      const normalized =
        ["APPROVED","PAID","CONFIRMED"].includes(status) ? "approved" :
        ["CANCELED","DENIED"].includes(status)           ? "declined" : "pending";

      await updateOrder(paymentId, normalized);
      console.log(`Pedido ${paymentId} → ${normalized}`);
    } else {
      console.warn("Webhook sem payment_id ou status:", JSON.stringify(event));
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Erro webhook Getnet:", err);
    return res.status(500).json({ error: "Erro interno" });
  }
};
