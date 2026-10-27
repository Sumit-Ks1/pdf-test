// Vercel serverless function: forwards a POST to the target API and returns the result.
// Avoids browser CORS limits. Only hosts listed in ALLOWED_HOSTS can be called.
// Example env var: ALLOWED_HOSTS=api.example.gov.in,staging.example.gov.in
// ALLOWED_HOSTS=* allows any public host; loopback, private and cloud-metadata addresses stay blocked.
const dns = require('node:dns').promises;
const net = require('node:net');

// Addresses inside Vercel's own network must never be reachable through an open proxy.
function isInternal(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isInternal(v.slice(7));
    return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

// Headers that describe the browser->proxy hop and must not be forwarded.
const DROP = ['host', 'content-length', 'connection', 'transfer-encoding'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  const { url, headers = {}, body = '' } = req.body || {};
  let target;
  try { target = new URL(url); } catch { return res.status(400).json({ error: 'Invalid url' }); }
  if (!/^https?:$/.test(target.protocol)) return res.status(400).json({ error: 'Only http and https URLs are supported' });
  const allowed = (process.env.ALLOWED_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.includes('*') && !allowed.includes(target.host)) {
    return res.status(403).json({ error: `Host ${target.host} is not allowed. Add it to the ALLOWED_HOSTS env var, or set ALLOWED_HOSTS=* to allow any host.` });
  }
  try {
    const addrs = await dns.lookup(target.hostname.replace(/^\[|\]$/g, ''), { all: true });
    if (addrs.some(a => isInternal(a.address))) {
      return res.status(403).json({ error: `Host ${target.host} resolves to a private address. The proxy runs on Vercel and cannot reach private networks.` });
    }
  } catch (e) {
    return res.status(502).json({ error: `Cannot resolve ${target.hostname}: ${e.code || e.message}` });
  }
  const fwd = Object.fromEntries(Object.entries(headers).filter(([k]) => !DROP.includes(k.toLowerCase())));
  try {
    const started = Date.now();
    const r = await fetch(target, {
      method: 'POST', headers: fwd, body: typeof body === 'string' ? body : JSON.stringify(body),
      redirect: 'manual', signal: AbortSignal.timeout(20000),
    });
    const text = await r.text();
    res.status(200).json({ status: r.status, ok: r.ok, ms: Date.now() - started, text });
  } catch (e) {
    res.status(502).json({ error: String(e && e.message || e) });
  }
};
