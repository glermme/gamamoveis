// ================================================================
// api/status-pix.js — Consulta status do PIX no Supabase
// ================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";

module.exports = async function handler(req, res) {
  try {
    const { tid } = req.query;

    if (!tid) {
      return res.status(400).json({ error: "tid nao informado" });
    }

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(500).json({ error: "Supabase nao configurado" });
    }

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/pedidos?tid=eq.${tid}&select=status,tid,reference,amount,customer_name`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Accept: "application/json",
        },
      }
    );

    const rows = await response.json();

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: "Pedido nao encontrado" });
    }

    return res.status(200).json(rows[0]);
  } catch (err) {
    console.error("[status-pix] Erro:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
