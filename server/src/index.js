// Kodar сервер: Anthropic-сумісний проксі з обліком токенів.
// Клієнт говорить тим самим протоколом, що й з api.anthropic.com,
// тому він однаково працює і з власним ключем, і через цей сервер.
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';

// --- мінімальний .env ---
try {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const PORT = process.env.PORT || 3000;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const DATA_FILE = 'data.json';

if (!ANTHROPIC_KEY) { console.error('Задайте ANTHROPIC_API_KEY у .env'); process.exit(1); }

// --- "база даних": JSON-файл (MVP; далі — Supabase/PostgreSQL) ---
function loadDb() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { clients: {}, usage: [] }; }
}
function saveDb(db) { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  return JSON.parse(data || '{}');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const db = loadDb();

  try {
    // POST /v1/messages — проксі до Anthropic зі списанням кредитів
    if (req.method === 'POST' && url.pathname === '/v1/messages') {
      const key = req.headers['x-api-key'];
      const client = key && db.clients[key];
      if (!client) return json(res, 401, { error: 'невірний ключ клієнта' });
      if ((client.credits ?? 0) <= 0) return json(res, 402, { error: 'кредити вичерпано' });

      const body = await readBody(req);
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      const data = await upstream.json();
      if (data.error) return json(res, 502, { error: 'помилка провайдера', detail: data.error });

      const used = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
      client.credits = Math.max(0, (client.credits ?? 0) - used);
      db.usage.push({ key, ts: new Date().toISOString(), model: body.model, tokens: used, credits_left: client.credits });
      saveDb(db);

      data.usage.platform_credits_left = client.credits;
      return json(res, 200, data);
    }

    // GET /v1/usage — залишок кредитів клієнта
    if (req.method === 'GET' && url.pathname === '/v1/usage') {
      const key = req.headers['x-api-key'];
      const client = key && db.clients[key];
      if (!client) return json(res, 401, { error: 'невірний ключ клієнта' });
      return json(res, 200, { credits: client.credits });
    }

    // POST /admin/keys — створити ключ клієнта (заголовок x-admin-token)
    if (req.method === 'POST' && url.pathname === '/admin/keys') {
      if (req.headers['x-admin-token'] !== ADMIN_TOKEN) return json(res, 403, { error: 'немає доступу' });
      const { credits } = await readBody(req);
      const key = 'ak-' + crypto.randomBytes(16).toString('hex');
      db.clients[key] = { credits: Number(credits) || 100000, created: new Date().toISOString() };
      saveDb(db);
      return json(res, 201, { key, credits: db.clients[key].credits });
    }

    return json(res, 404, { error: 'не знайдено' });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`Kodar сервер: http://localhost:${PORT}\nPOST /v1/messages — проксі (Anthropic-сумісний)\nGET /v1/usage — залишок кредитів\nPOST /admin/keys — створення ключа (x-admin-token)`));
