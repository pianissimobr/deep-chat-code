import { runtimeFetch } from '@/lib/runtime-fetch';
import { useCallback, useState } from 'react';
import { toast } from '@/components/ui';

export interface DeepSeekConstrutorState {
  id: string;
  status: 'idle' | 'gerando-arvore' | 'executando' | 'sucesso' | 'erro';
  mensagem?: string;
  caminhoArvore?: string;
}

/**
 * Hook que expõe o Construtor de Código DeepSeek:
 * 1. Gera a árvore de arquivos do projeto (tree-content-generator wrapper).
 * 2. Envia a resposta do DeepSeek + contexto para o loop OpenRouter → execução local.
 */
export function useDeepSeekConstrutor() {
  const [estado, setEstado] = useState<DeepSeekConstrutorState>({
    id: crypto.randomUUID(),
    status: 'idle',
  });

  const gerarArvore = useCallback(async (diretorio: string, saida = 'estrutura_projeto.md') => {
    setEstado((s) => ({ ...s, status: 'gerando-arvore' }));
    try {
      const resposta = await runtimeFetch('/api/deepseek-construtor/gerar-arvore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diretorio, saida }),
      });
      if (!resposta.ok) {
        throw new Error(`HTTP ${resposta.status}`);
      }
      const json = await resposta.json();
      setEstado((s) => ({ ...s, status: 'idle', caminhoArvore: json.caminho_md }));
      return json.caminho_md as string;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setEstado((s) => ({ ...s, status: 'erro', mensagem: msg }));
      toast.error('Falha ao gerar árvore do projeto', { description: msg });
      return null;
    }
  }, []);

  const executar = useCallback(
    async (textoDeepSeek: string, caminhoArvore?: string, workspace = './workspace_construtor', modelo = 'cohere/north-mini-code:free') => {
      setEstado((s) => ({ ...s, status: 'executando' }));
      try {
        const resposta = await runtimeFetch('/api/deepseek-construtor/executar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resposta: textoDeepSeek,
            contexto: caminhoArvore,
            workspace,
            modelo,
          }),
        });
        if (!resposta.ok) {
          throw new Error(`HTTP ${resposta.status}`);
        }
        const json = await resposta.json();
        if (!json.ok) {
          throw new Error(json.error || 'Falha na execução');
        }
        setEstado((s) => ({ ...s, status: 'sucesso' }));
        toast.success('Código construído com sucesso');
        return json;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setEstado((s) => ({ ...s, status: 'erro', mensagem: msg }));
        toast.error('Falha ao construir código', { description: msg });
        return null;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setEstado({ id: crypto.randomUUID(), status: 'idle' });
  }, []);

  return { estado, gerarArvore, executar, reset };
}
