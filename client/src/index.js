#!/usr/bin/env node
import readline from 'node:readline/promises';
import fs from 'node:fs';
import { runAgentTask } from './agent.js';
import { TOOL_DEFINITIONS, createExecutor } from './tools.js';

// --- мінімальний .env без залежностей ---
function loadEnv(file = '.env') {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}
loadEnv();

// --- аргументи командного рядка ---
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const m = process.argv[i].match(/^--([a-z-]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? process.argv[++i];
}

const API_KEY = args['api-key'] ?? process.env.AI_API_KEY;
const BASE_URL = (args['base-url'] ?? process.env.AI_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, '');
const MODEL = args.model ?? process.env.AI_MODEL ?? 'claude-sonnet-4-20250514';

if (!API_KEY) {
  console.error('Помилка: не задано AI_API_KEY. Скопіюйте .env.example у .env і впишіть ключ.');
  process.exit(1);
}

const SYSTEM_PROMPT = `You are Kodar, a terminal coding agent working in the user's project directory.
Rules:
- Inspect files with list_dir/read_file before editing anything.
- Make minimal, focused changes. Prefer editing one file at a time.
- Never run destructive commands (rm -rf, git push --force, etc.) without asking.
- After finishing, briefly summarize what you changed.
- Reply in the same language the user writes in.`;

const C = {
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function confirm(question) {
  const a = (await rl.question(C.yellow(`  ${question} [y/N] `))).trim().toLowerCase();
  return a === 'y' || a === 'yes' || a === 'так' || a === 'т' || a === 'д';
}

const executeTool = createExecutor({ cwd: process.cwd(), confirm });
const session = { messages: [] };

console.log(C.bold(`Kodar v0.1 — модель: ${C.cyan(MODEL)}`));
console.log(C.dim(`Провайдер: ${BASE_URL}`));
console.log(C.dim('Команди: /exit — вихід, /reset — нова сесія, /usage — залишок кредитів (через сервер Kodar)\n'));

while (true) {
  const input = (await rl.question(C.green('› '))).trim();
  if (!input) continue;
  if (input === '/exit') break;
  if (input === '/reset') { session.messages = []; console.log(C.dim('[нова сесія]')); continue; }
  if (input === '/usage') {
    try {
      const res = await fetch(`${BASE_URL}/v1/usage`, { headers: { 'x-api-key': API_KEY } });
      console.log(C.dim(JSON.stringify(await res.json())));
    } catch { console.log(C.dim('Недоступно для цього провайдера.')); }
    continue;
  }
  try {
    await runAgentTask({
      session, baseUrl: BASE_URL, apiKey: API_KEY, model: MODEL,
      system: SYSTEM_PROMPT, tools: TOOL_DEFINITIONS, executeTool, userText: input,
      onText: (t) => console.log(t + '\n'),
      onTool: (name, inp) => console.log(C.cyan(`⟢ ${name} ${C.dim(JSON.stringify(inp).slice(0, 120))}`)),
      onError: (e) => console.error(C.yellow(`[помилка] ${e.message}`)),
    });
  } catch (e) {
    console.error(C.yellow(`[помилка] ${e.message}`));
  }
}

rl.close();
