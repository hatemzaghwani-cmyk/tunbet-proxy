const http = require('http');
const https = require('https');

const SUPA_URL = 'https://cjzjrnagpsdmolvbkhnu.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqempybmFncHNkbW9sdmJraG51Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDM0ODY4NCwiZXhwIjoyMDk1OTI0Njg0fQ.TmowEatc4g2xpD-GT0r-jofX1zCtXjTD-s4LF7JSs6o';
const CLIENT_ID = 'Hatem1_TND';
const CLIENT_SECRET = 'JdYysA2TS7K3xzIYJoOlRn2z9i9XWk57';
const ORO_DASH = 'https://und7br.sxvwlkohlv.com';
let dashCookie = '';

function httpReq(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', ...opts.headers };
    if (opts.contentType) headers['Content-Type'] = opts.contentType;
    else if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const o = { hostname: u.hostname, port: 443, path: u.pathname + u.search, method: opts.method || 'GET', headers };
    const req = https.request(o, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        const sc = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
        try { resolve({ body: JSON.parse(d), status: res.statusCode, cookies: sc, location: res.headers.location }); }
        catch { resolve({ body: d, status: res.statusCode, cookies: sc, location: res.headers.location }); }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function loginDashboard() {
  const page = await httpReq(ORO_DASH + '/Account/Login');
  const m = typeof page.body === 'string' ? page.body.match(/value="(CfDJ8[^"]+)"/) : null;
  if (!m) { console.error('No CSRF token, page size:', typeof page.body === 'string' ? page.body.length : 0); return false; }
  const csrf = m[1];
  const body = 'AgentCode=Hatem1_TND&password=' + encodeURIComponent('Domar@95') + '&__RequestVerificationToken=' + encodeURIComponent(csrf);
  const login = await httpReq(ORO_DASH + '/Account/Login', {
    method: 'POST', body, contentType: 'application/x-www-form-urlencoded',
    headers: { Cookie: page.cookies || '' }
  });
  if (login.cookies && login.cookies.includes('Identity')) {
    dashCookie = (page.cookies ? page.cookies + '; ' : '') + login.cookies;
    console.log('Dashboard login SUCCESS');
    return true;
  }
  console.error('Login failed, status:', login.status);
  return false;
}

async function dashCall(path, data) {
  if (!dashCookie) await loginDashboard();
  const body = Object.entries(data).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const r = await httpReq(ORO_DASH + path, {
    method: 'POST', body, contentType: 'application/x-www-form-urlencoded',
    headers: { Cookie: dashCookie, 'X-Requested-With': 'XMLHttpRequest' }
  });
  return r.body;
}

async function supaRest(method, path, body) {
  const r = await httpReq(SUPA_URL + '/rest/v1' + path, {
    method, headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined
  });
  return r.body;
}

async function handleBalance(data) {
  const users = await supaRest('GET', '/users?username=eq.' + data.userCode + '&select=balance');
  if (!Array.isArray(users) || !users.length) return { success: false, message: 0, errorCode: 2 };
  return { success: true, message: Number(users[0].balance), errorCode: 0 };
}

async function handleTransaction(data) {
  const { userCode, transactionCode, amount, vendorCode, gameCode, roundId } = data;
  const users = await supaRest('GET', '/users?username=eq.' + userCode + '&select=id,balance');
  if (!Array.isArray(users) || !users.length) return { success: false, message: 0, errorCode: 2 };
  const u = users[0], amt = Number(amount), bal = Number(u.balance), nb = bal + amt;
  if (amt < 0 && nb < 0) return { success: false, message: bal, errorCode: 4 };
  const dups = await supaRest('GET', '/transactions?description=eq.oro:' + transactionCode + '&select=id');
  if (Array.isArray(dups) && dups.length) return { success: false, message: bal, errorCode: 6 };
  await supaRest('POST', '/rpc/update_balance', { p_user_id: u.id, p_action: amt >= 0 ? 'credit' : 'debit', p_amount: Math.abs(amt) });
  await supaRest('POST', '/transactions', { user_id: u.id, type: amt >= 0 ? 'oro_win' : 'oro_bet', amount: Math.abs(amt), balance_before: bal, balance_after: nb, description: 'oro:' + transactionCode + '|' + (vendorCode||'') + '|' + (gameCode||'') });
  return { success: true, message: nb, errorCode: 0 };
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Content-Type': 'application/json' };

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      const d = body ? JSON.parse(body) : {};
      const p = req.url;
      let r;
      if (p === '/api/launch' || d.action === 'launch') {
        r = await dashCall('/Board/GetGameServerPageUrl', { agentId: '686', vendorCode: d.vendorCode || 'casino-pragmatic', board: '5' });
      } else if (p === '/api/vendors') {
        r = await dashCall('/Maintenance/GetDataByVendor', { agentId: '686', vendorType: '0' });
      } else if (p.includes('/api/balance') || d.action === 'balance') {
        const auth = req.headers.authorization || '';
        const dec = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();
        if (dec !== CLIENT_ID + ':' + CLIENT_SECRET) { res.writeHead(401, CORS); return res.end(JSON.stringify({ success: false, errorCode: 401 })); }
        r = await handleBalance(d);
      } else if (p.includes('/api/transaction') || p.includes('/api/batch') || d.action === 'transaction') {
        const auth = req.headers.authorization || '';
        const dec = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();
        if (dec !== CLIENT_ID + ':' + CLIENT_SECRET) { res.writeHead(401, CORS); return res.end(JSON.stringify({ success: false, errorCode: 401 })); }
        if (d.transactions) { let lb = 0; for (const t of d.transactions) { r = await handleTransaction({...t, userCode: t.userCode || d.userCode}); lb = r.message; } r = { success: true, message: lb, errorCode: 0 }; }
        else r = await handleTransaction(d);
      } else { r = { success: true, message: 'TunBet Proxy v2', tunnel: true }; }
      res.writeHead(200, CORS); res.end(JSON.stringify(r));
    } catch (e) { console.error(e.message); res.writeHead(500, CORS); res.end(JSON.stringify({ success: false, message: e.message, errorCode: 500 })); }
  });
});

loginDashboard().then(() => {
  server.listen(process.env.PORT || 3456, () => console.log('TunBet proxy v2 on port ' + (process.env.PORT || 3456)));
}).catch(e => {
  console.error('Login error:', e.message);
  server.listen(process.env.PORT || 3456, () => console.log('TunBet proxy v2 on port ' + (process.env.PORT || 3456) + ' (no dash)'));
});
