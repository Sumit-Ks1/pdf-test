// Vercel serverless function: forwards a POST to the target API and returns the result.
// Avoids browser CORS limits. Only hosts listed in ALLOWED_HOSTS can be called.
// Example env var: ALLOWED_HOSTS=api.example.gov.in,staging.example.gov.in
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  const { url, headers = {}, body = '' } = req.body || {};
  let target;
  try { target = new URL(url); } catch { return res.status(400).json({ error: 'Invalid url' }); }
  const allowed = (process.env.ALLOWED_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.includes(target.host)) {
    return res.status(403).json({ error: `Host ${target.host} is not allowed. Add it to the ALLOWED_HOSTS env var.` });
  }
  try {
    const started = Date.now();
    const r = await fetch(target, { method: 'POST', headers, body, signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    res.status(200).json({ status: r.status, ok: r.ok, ms: Date.now() - started, text });
  } catch (e) {
    res.status(502).json({ error: String(e && e.message || e) });
  }
};
