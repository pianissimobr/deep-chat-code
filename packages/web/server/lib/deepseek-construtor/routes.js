import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

function pathDirname(p) {
  return p.split('/').slice(0, -1).join('/') || '.';
}

const PYTHON_DIR = join(__dirname, 'python');
const PYTHON_BIN = process.env.PYTHON_PATH || 'python3';
const BRIDGE_DIR = process.env.DEEPSEEK_BRIDGE_DIR || join(process.cwd(), '.openchamber', 'deepseek-bridge');
const BRIDGE_FILE = join(BRIDGE_DIR, 'last-response.json');

const runPython = (script, args = [], timeoutMs = 300_000) => {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [join(PYTHON_DIR, script), ...args], {
      cwd: PYTHON_DIR,
      timeout: timeoutMs,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    child.on('error', (err) => {
      reject(err);
    });
  });
};

export const registerDeepSeekConstrutorRoutes = (app) => {
  // The base server only parses JSON for a whitelist of /api paths, so this
  // module parses its own body by reading the request stream directly.
  app.use('/api/deepseek-construtor', (req, res, next) => {
    if (req.method === 'GET' || req.headers['content-type'] !== 'application/json') {
      next();
      return;
    }
    if (req._deepseekBodyParsed) {
      next();
      return;
    }
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 50 * 1024 * 1024) {
        req.destroy();
        res.status(413).json({ error: 'Payload too large' });
      }
    });
    req.on('end', () => {
      try {
        req.body = data ? JSON.parse(data) : {};
      } catch {
        req.body = {};
      }
      req._deepseekBodyParsed = true;
      next();
    });
    req.on('error', next);
  });
  // Ponte Tampermonkey -> OpenChamber: o userscript em chat.deepseek.com faz POST
  // com { text } e o servidor apenas persiste para o painel via polling/storage.
  // Tambem um fallback quando o postMessage entre abas falha.
  app.post('/api/deepseek-construtor/entregar-resposta', async (req, res) => {
    try {
      const text = String(req.body?.text ?? req.body?.texto ?? '').trim();
      if (!text) {
        return res.status(400).json({ error: 'text é obrigatório' });
      }
      await mkdir(BRIDGE_DIR, { recursive: true });
      const entry = { text, ts: new Date().toISOString(), origin: req.ip ?? null };
      await writeFile(BRIDGE_FILE, JSON.stringify(entry, null, 2), 'utf-8');
      return res.json({ ok: true, ...entry, msg: 'Resposta entregue' });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Polling endpoint: o painel pergunta sem cessar se chegou algo novo.
  app.get('/api/deepseek-construtor/ultima-resposta', async (_req, res) => {
    try {
      const { readFile } = await import('fs/promises');
      const raw = await readFile(BRIDGE_FILE, 'utf-8');
      const entry = JSON.parse(raw);
      return res.json({ ok: true, text: entry.text, ts: entry.ts });
    } catch {
      return res.json({ ok: false, text: null, ts: null, msg: 'Nenhuma resposta ainda' });
    }
  });

  // Gera a árvore de arquivos do projeto (tree-content-generator wrapper)
  app.post('/api/deepseek-construtor/gerar-arvore', async (req, res) => {
    try {
      const { diretorio, saida = 'estrutura_projeto.md', maxLines } = req.body || {};
      if (!diretorio) {
        return res.status(400).json({ error: 'diretorio é obrigatório' });
      }
      const args = [diretorio, saida];
      if (maxLines) args.push('--max-lines', String(maxLines));
      const result = await runPython('gerador_auto.py', args);
      if (result.code !== 0) {
        return res.status(500).json({ error: result.stderr || 'Falha ao gerar árvore' });
      }
      const match = result.stdout.match(/✅ Gerado: (.+)/);
      const caminho = match ? match[1].trim() : saida;
      return res.json({ ok: true, caminho_md: caminho, saida });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Executa o loop OpenRouter → escrita de código → execução local → feedback para DeepSeek
  app.post('/api/deepseek-construtor/executar', async (req, res) => {
    try {
      const { resposta, contexto, workspace = './workspace_construtor', modelo = process.env.OPENROUTER_MODEL || 'cohere/north-mini-code:free' } = req.body || {};
      if (!resposta) {
        return res.status(400).json({ error: 'resposta é obrigatório' });
      }
      const args = ['--resposta', resposta, '--workspace', workspace, '--modelo', modelo];
      if (contexto) args.push('--contexto', contexto);
      const result = await runPython('construtor.py', args, 600_000);
      if (result.code !== 0) {
        return res.status(500).json({ ok: false, error: result.stderr || 'Falha na execução', stdout: result.stdout });
      }
      return res.json({ ok: true, stdout: result.stdout, stderr: result.stderr });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
};
