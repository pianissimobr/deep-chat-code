import { spawn } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

function pathDirname(p) {
  return p.split('/').slice(0, -1).join('/') || '.';
}

const PYTHON_DIR = join(__dirname, 'python');
const PYTHON_BIN = process.env.PYTHON_PATH || 'python3';

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

  // Executa o loop OpenAI → escrita de código → execução local → feedback para DeepSeek
  app.post('/api/deepseek-construtor/executar', async (req, res) => {
    try {
      const { resposta, contexto, workspace = './workspace_construtor', modelo = 'gpt-4o-mini' } = req.body || {};
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
