// ================================================================
// api/sheet-gama.js — Proxy planilha Gama Móveis (sem cache)
// ================================================================
// Adicione no Vercel → Settings → Environment Variables:
//   SHEET_URL_GAMA = seu link do Google Sheets CSV da Gama
// ================================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const SHEET_URL = process.env.SHEET_URL_GAMA || process.env.SHEET_URL;

  if (!SHEET_URL) {
    return res.status(400).json({ error: 'SHEET_URL_GAMA não configurada no Vercel' });
  }

  try {
    const response = await fetch(SHEET_URL, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
      }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const csv = await response.text();

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.status(200).send(csv);

  } catch (err) {
    console.error('Erro proxy Gama:', err);
    return res.status(500).json({ error: err.message });
  }
}
