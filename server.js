const http = require('http');
const https = require('https');

// OroPlay config
const ORO_API = 'https://api.pgf-asu2nd.com';
const CLIENT_ID = 'Hatem1_TND';
const CLIENT_SECRET = 'JdYysA2TS7K3xzIYJoOlRn2z9i9XWk57';

// Supabase config
const SUPA_URL = 'https://cjzjrnagpsdmolvbkhnu.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqempybmFncHNkbW9sdmJraG51Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDM0ODY4NCwiZXhwIjoyMDk1OTI0Njg0fQ.TmowEatc4g2xpD-GT0r-jofX1zCtXjTD-s4LF7JSs6o';

let oroToken = null;
let tokenExpiry = 0;

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...options.headers },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, json: () => JSON.parse(data), text: () => data }); }
        catch(e) { resolve({ ok: false, status: res.statusCode, json: () => ({}), text: () => data }); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function getOroToken() {
  if (oroToken && Date.now() / 1000 < tokenExpiry - 60) return oroToken;
  const res = await fetch(`${ORO_API}/api/v2/auth/createtoken`, {
    method: 'POST',
    body: JSON.stringify({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
  });
  const data = res.json();
  if (data.token) {
    oroToken = data.token;
    tokenExpiry = data.expiration;
    return oroToken;
  }
  throw new Error('Failed to get OroPlay token: ' + JSON.stringify(data));
}

async function oroApi(method, path, body) {
  const token = await getOroToken();
  const res = await fetch(`${ORO_API}/api/v2${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function supaApi(method, path, body) {
  const res = await fetch(`${SUPA_URL}/rest/v1${path}`, {
    method,
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// Handle game launch
async function launchGame(userCode, vendorCode, gameCode, language) {
  // 1. Ensure user exists on OroPlay
  try { await oroApi('POST', '/user/create', { userCode }); } catch(e) {}
  
  // 2. Get user balance from Supabase
  const users = await supaApi('GET', `/users?username=eq.${userCode}&select=balance`);
  const balance = users?.[0]?.balance || 0;
  
  // 3. Deposit balance to OroPlay (if any)
  if (balance > 0) {
    const orderNo = `dep_${Date.now()}`;
    await oroApi('POST', '/user/deposit', { userCode, balance: Number(balance), orderNo });
  }
  
  // 4. Get game launch URL
  const result = await oroApi('POST', '/game/launch-url', {
    vendorCode, gameCode, userCode,
    language: language || 'en',
    lobbyUrl: 'https://tunbet.surge.sh/live',
  });
  
  return result;
}

// Handle withdraw all (when game closes)
async function withdrawAll(userCode) {
  const result = await oroApi('POST', '/user/withdraw-all', { userCode });
  if (result.success && result.message > 0) {
    // Credit back to Supabase
    const users = await supaApi('GET', `/users?username=eq.${userCode}&select=id,balance`);
    if (users?.[0]) {
      await supaApi('POST', '/rpc/update_balance', {
        p_user_id: users[0].id, p_action: 'credit', p_amount: result.message
      });
    }
  }
  return result;
}

// Seamless Wallet Callbacks
async function handleBalance(body) {
  const { userCode } = body;
  const users = await supaApi('GET', `/users?username=eq.${userCode}&select=balance`);
  if (!users?.length) return { success: false, message: 0, errorCode: 2 };
  return { success: true, message: Number(users[0].balance), errorCode: 0 };
}

async function handleTransaction(body) {
  const { userCode, transactionCode, amount, vendorCode, gameCode, roundId } = body;
  const users = await supaApi('GET', `/users?username=eq.${userCode}&select=id,balance`);
  if (!users?.length) return { success: false, message: 0, errorCode: 2 };
  
  const user = users[0];
  const txAmount = Number(amount);
  const currentBalance = Number(user.balance);
  const newBalance = currentBalance + txAmount;
  
  if (txAmount < 0 && newBalance < 0) return { success: false, message: currentBalance, errorCode: 4 };
  
  // Check duplicate
  const dups = await supaApi('GET', `/transactions?description=eq.oro:${transactionCode}&select=id`);
  if (dups?.length > 0) return { success: false, message: currentBalance, errorCode: 6 };
  
  // Update balance
  await supaApi('POST', '/rpc/update_balance', {
    p_user_id: user.id,
    p_action: txAmount >= 0 ? 'credit' : 'debit',
    p_amount: Math.abs(txAmount),
  });
  
  // Record transaction
  await supaApi('POST', '/transactions', {
    user_id: user.id, type: txAmount >= 0 ? 'oro_win' : 'oro_bet',
    amount: Math.abs(txAmount), balance_before: currentBalance, balance_after: newBalance,
    description: `oro:${transactionCode}|${vendorCode}|${gameCode}|r:${roundId}`,
  });
  
  return { success: true, message: newBalance, errorCode: 0 };
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Content-Type': 'application/json' };

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const data = body ? JSON.parse(body) : {};
      const path = req.url;
      let result;
      
      if (path === '/api/launch') {
        result = await launchGame(data.userCode, data.vendorCode, data.gameCode, data.language);
      } else if (path === '/api/withdraw-all') {
        result = await withdrawAll(data.userCode);
      } else if (path === '/api/vendors') {
        result = await oroApi('GET', '/vendors/list');
      } else if (path === '/api/games') {
        result = await oroApi('POST', '/games/list', { vendorCode: data.vendorCode, language: data.language || 'en' });
      } else if (path.includes('/api/balance')) {
        // Seamless wallet callback
        const auth = req.headers.authorization || '';
        const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();
        if (decoded !== `${CLIENT_ID}:${CLIENT_SECRET}`) {
          res.writeHead(401, CORS); return res.end(JSON.stringify({ success: false, errorCode: 401 }));
        }
        result = await handleBalance(data);
      } else if (path.includes('/api/transaction')) {
        const auth = req.headers.authorization || '';
        const decoded = Buffer.from(auth.replace('Basic ', ''), 'base64').toString();
        if (decoded !== `${CLIENT_ID}:${CLIENT_SECRET}`) {
          res.writeHead(401, CORS); return res.end(JSON.stringify({ success: false, errorCode: 401 }));
        }
        if (data.transactions) {
          // Batch
          let lastBal = 0;
          for (const tx of data.transactions) {
            result = await handleTransaction({ ...tx, userCode: tx.userCode || data.userCode });
            lastBal = result.message;
          }
          result = { success: true, message: lastBal, errorCode: 0 };
        } else {
          result = await handleTransaction(data);
        }
      } else if (path === '/api/status') {
        result = { success: true, message: 'TunBet OroPlay Proxy v1.0', errorCode: 0 };
      } else {
        result = { success: false, message: 'Not found', errorCode: 404 };
      }
      
      res.writeHead(200, CORS);
      res.end(JSON.stringify(result));
    } catch(e) {
      console.error('Error:', e.message);
      res.writeHead(500, CORS);
      res.end(JSON.stringify({ success: false, message: e.message, errorCode: 500 }));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`TunBet proxy running on port ${PORT}`));
