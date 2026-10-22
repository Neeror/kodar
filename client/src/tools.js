// Інструменти агента: читання, запис, лістинг, команди.
// Шляхи обмежені робочою папкою (cwd) — вихід за межі заборонено.
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const runCmd = promisify(exec);

const MAX_OUTPUT = 20000;

export const TOOL_DEFINITIONS = [
  {
    name: 'list_dir',
    description: 'Показати список файлів і папок у проєкті. Використовуй спочатку, щоб орієнтуватися.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Відносний шлях, напр. "src"' } },
      required: [],
    },
  },
  {
    name: 'read_file',
    description: 'Прочитати вміст текстового файлу.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Створити файл або повністю перезаписати його вміст.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_command',
    description: 'Виконати shell-команду в робочій папці (npm test, git status тощо). Небезпечні команди потребують підтвердження користувачем.',
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
  },
];

function safePath(cwd, rel) {
  const abs = path.resolve(cwd, rel ?? '.');
  if (!abs.startsWith(path.resolve(cwd))) throw new Error('Доступ поза робочою папкою заборонено');
  return abs;
}

export function createExecutor({ cwd, confirm }) {
  return async (name, input) => {
    switch (name) {
      case 'list_dir': {
        const dir = safePath(cwd, input.path);
        const entries = await fs.readdir(dir, { withFileTypes: true });
        return entries.map((e) => `${e.isDirectory() ? 'd' : '-'} ${e.name}`).join('\n') || '(порожньо)';
      }
      case 'read_file': {
        const file = safePath(cwd, input.path);
        return (await fs.readFile(file, 'utf8')).slice(0, MAX_OUTPUT);
      }
      case 'write_file': {
        const file = safePath(cwd, input.path);
        let exists = false;
        try { await fs.access(file); exists = true; } catch {}
        if (exists && !(await confirm(`Перезаписати ${input.path}?`))) return 'Користувач відмовив у перезаписі.';
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, input.content);
        return `Файл ${input.path} записано (${input.content.length} символів).`;
      }
      case 'run_command': {
        const cmd = input.command;
        const risky = /(rm\s+-rf|git\s+push|git\s+reset|mkfs|dd\s|sudo)/i;
        if (risky.test(cmd)) {
          if (!(await confirm(`Виконати команду: ${cmd}?`))) return 'Користувач відмовив у виконанні.';
        }
        const { stdout, stderr } = await runCmd(cmd, { cwd, timeout: 60000, maxBuffer: 1024 * 1024 });
        const out = `${stdout}${stderr ? '\nSTDERR:\n' + stderr : ''}`;
        return (out.trim() || '(без виводу)').slice(0, MAX_OUTPUT);
      }
      default:
        throw new Error(`Невідомий інструмент: ${name}`);
    }
  };
}
