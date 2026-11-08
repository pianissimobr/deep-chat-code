import React from 'react';
import { Icon } from '@/components/icon/Icon';
import type { MessageExtraAction } from '@/components/chat/message/MessageBody';

/**
 * Monta o objeto MessageExtraAction para "Construir código" usando valores
 * já resolvidos (estado, diretório, handlers, labels traduzidas). Sem hooks
 * dentro, para ser chamada com segurança dentro do ChatMessage.
 */
export function montarDeepSeekConstrutorAction({
  textoDeepSeek,
  diretorio,
  estado,
  gerarArvore,
  executar,
  labelConstruir,
  labelConstruindo,
}: {
  textoDeepSeek: string;
  diretorio: string;
  estado: { status: 'idle' | 'gerando-arvore' | 'executando' | 'sucesso' | 'erro' };
  gerarArvore: (diretorio: string, saida?: string) => Promise<string | null>;
  executar: (
    resposta: string,
    contexto?: string,
    workspace?: string,
  ) => Promise<{ ok: boolean; stdout?: string; stderr?: string } | null>;
  labelConstruir: string;
  labelConstruindo: string;
}): MessageExtraAction | null {
  if (!diretorio) return null;

  const label = estado.status === 'executando' ? labelConstruindo : labelConstruir;

  const handleSelect = React.useCallback(async () => {
    if (estado.status === 'executando') return;
    const caminhoArvore = await gerarArvore(diretorio);
    if (!caminhoArvore) return;
    await executar(textoDeepSeek, caminhoArvore);
  }, [diretorio, textoDeepSeek, estado.status, gerarArvore, executar]);

  return {
    id: 'deepseek-construtor',
    label,
    icon: <Icon name="code" className="h-3.5 w-3.5" />,
    onSelect: () => {
      void handleSelect();
    },
  };
}
