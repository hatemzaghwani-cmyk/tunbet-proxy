const https = require('https');

const ORO_API = 'https://api.pgf-asu2nd.com';
const CLIENT_ID = 'Hatem1_TND';
const CLIENT_SECRET = 'JdYysA2TS7K3xzIYJoOlRn2z9i9XWk57';
const SUPA_URL = 'https://cjzjrnagpsdmolvbkhnu.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqempybmFncHNkbW9sdmJraG51Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDM0ODY4NCwiZXhwIjoyMDk1OTI0Njg0fQ.TmowEatc4g2xpD-GT0r-jofX1zCtXjTD-s4LF7JSs6o';

let oroToken = null, tokenExpiry = 0;

function httpReq(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const o = { hostname: u.hostname, port: 443, path: u.pathname + u.search, method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', ...opts.headers } };
    const req = https.request(o, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({ error: d }); } });
    });
    req.on('error', reject);
    if (opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    req.end();
  });
}

async function getToken() {
  if (oroToken && Date.now()/1000 < tokenExpiry - 60) return oroToken;
  const r = await httpReq(`${ORO_API}/api/v2/auth/createtoken`, { method: 'POST', body: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET } });
  if (r.token) { oroToken = r.token; tokenExpiry = r.expiration; return oroToken; }
  throw new Error('Token failed: ' + JSON.stringify(r));
}

async function oroCall(method, path, body) {
  const t = await getToken();
  return httpReq(`${ORO_API}/api/v2${path}`, { method, headers: { Authorization: `Bearer ${t}` }, body });
}

async function supaCall(method, path, body) {
  return httpReq(`${SUPA_URL}/rest/v1${path}`, { method, headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Prefer: 'return=representation' }, body });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const body = req.body || {};
    const action = body.action || req.query?.action || '';

    if (action === 'launch') {
      const { userCode, vendorCode, gameCode, language } = body;
      try { await oroCall('POST', '/user/create', { userCode }); } catch(e) {}
      const users = await supaCall('GET', `/users?username=eq.${userCode}&select=balance`);
      const bal = users?.[0]?.balance || 0;
      if (bal > 0) await oroCall('POST', '/user/deposit', { userCode, balance: Number(bal), orderNo: `dep_${Date.now()}` });
      const result = await oroCall('POST', '/game/launch-url', { vendorCode, gameCode, userCode, language: language || 'en', lobbyUrl: 'https://tunbet.surge.sh/live' });
      return res.json(result);
    }

    if (action === 'withdraw') {
      const { userCode } = body;
      const result = await oroCall('POST', '/user/withdraw-all', { userCode });
      if (result.success && result.message > 0) {
        const users = await supaCall('GET', `/users?username=eq.${userCode}&select=id`);
        if (users?.[0]) await supaCall('POST', '/rpc/update_balance', { p_user_id: users[0].id, p_action: 'credit', p_amount: result.message });
      }
      return res.json(result);
    }

    if (action === 'balance') {
      const auth = req.headers.authorization || '';
      const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();
      if (decoded !== `${CLIENT_ID}:${CLIENT_SECRET}`) return res.status(401).json({ success: false, errorCode: 401 });
      const users = await supaCall('GET', `/users?username=eq.${body.userCode}&select=balance`);
      return res.json(users?.length ? { success: true, message: Number(users[0].balance), errorCode: 0 } : { success: false, message: 0, errorCode: 2 });
    }

    if (action === 'transaction') {
      const auth = req.headers.authorization || '';
      const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();
      if (decoded !== `${CLIENT_ID}:${CLIENT_SECRET}`) return res.status(401).json({ success: false, errorCode: 401 });
      const { userCode, transactionCode, amount, vendorCode, gameCode, roundId } = body;
      const users = await supaCall('GET', `/users?username=eq.${userCode}&select=id,balance`);
      if (!users?.length) return res.json({ success: false, message: 0, errorCode: 2 });
      const user = users[0], txAmount = Number(amount), bal = Number(user.balance), newBal = bal + txAmount;
      if (txAmount < 0 && newBal < 0) return res.json({ success: false, message: bal, errorCode: 4 });
      const dups = await supaCall('GET', `/transactions?description=eq.oro:${transactionCode}&select=id`);
      if (dups?.length) return res.json({ success: false, message: bal, errorCode: 6 });
      await supaCall('POST', '/rpc/update_balance', { p_user_id: user.id, p_action: txAmount >= 0 ? 'credit' : 'debit', p_amount: Math.abs(txAmount) });
      await supaCall('POST', '/transactions', { user_id: user.id, type: txAmount >= 0 ? 'oro_win' : 'oro_bet', amount: Math.abs(txAmount), balance_before: bal, balance_after: newBal, description: `oro:${transactionCode}|${vendorCode||''}|${gameCode||''}|r:${roundId||''}` });
      return res.json({ success: true, message: newBal, errorCode: 0 });
    }

    return res.json({ success: true, message: 'TunBet API v1.0', errorCode: 0 });
  } catch(e) {
    console.error(e);
    return res.status(500).json({ success: false, message: e.message, errorCode: 500 });
  }
};
