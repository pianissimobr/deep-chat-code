import React, { useCallback, useRef, useState } from 'react';
import { Icon } from '@/components/icon/Icon';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useConfigStore } from '@/stores/useConfigStore';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/**
 * DeepSeekPanel - Injeta o chat do DeepSeek diretamente na interface do OpenChamber
 * sem depender de extensões externas (Tampermonkey).
 *
 * Renderiza um <iframe> apontado para o chat do DeepSeek dentro de um painel
 * lateral deslizante, com controle de abertura/fechamento e um botão flutuante
 * para alternar a visibilidade.
 */
export function DeepSeekPanel() {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const deepseekUrl = (() => {
    try {
      return typeof window !== 'undefined' && (window as any).OPENCHAMBER_DEEPSEEK_URL
        ? String((window as any).OPENCHAMBER_DEEPSEEK_URL)
        : 'https://chat.deepseek.com';
    } catch {
      return 'https://chat.deepseek.com';
    }
  })();

  const togglePanel = useCallback(() => setIsOpen((prev) => !prev), []);

  return (
    <>
      {/* Botão flutuante para abrir/fechar o painel (sempre visível quando não fixado) */}
      {!isPinned && (
        <Button
          ref={toggleRef}
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'fixed right-4 bottom-4 z-50 bg-blue-600 text-white shadow-lg rounded-full',
            'hover:bg-blue-500 transition-colors',
            'group',
          )}
          aria-label={t('chat.deepseekPanel.toggleTitle')}
          onClick={togglePanel}
        >
                <Icon name="close" className="h-4 w-4 group-hover:rotate-12 transition-transform" />
          <span className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-red-500 text-xs text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            🤖
          </span>
        </Button>
      )}

      {/* Painel lateral com o chat do DeepSeek */}
      {isOpen && (
        <div
          ref={panelRef}
          className={cn(
            'fixed top-0 right-0 h-full w-96 bg-surface-elevated border-l border-edge z-50 flex flex-col shadow-2xl',
            'dark:bg-surface-elevated',
          )}
        >
          {/* Cabeçalho do painel */}
          <div className={cn('flex items-center justify-between p-4 border-b border-edge-muted', 'dark:border-edge-muted')}>
            <div className="flex items-center gap-2">
              <Icon name="code" className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span className="font-semibold text-foreground">DeepSeek Chat</span>
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 p-1">
                    <Icon name="more" className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setIsPinned((p) => !p)}>
                    {isPinned ? t('chat.deepseekPanel.unpin') : t('chat.deepseekPanel.pin')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setIsOpen(false)}>
                    {t('chat.deepseekPanel.close')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 p-1"
                onClick={() => setIsOpen(false)}
                aria-label={t('chat.deepseekPanel.close')}
              >
                <Icon name="close" className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Iframe do chat do DeepSeek */}
          <div className="flex-1 relative overflow-hidden bg-background dark:bg-background">
            <iframe
              src={deepseekUrl}
              title="DeepSeek Chat"
              className="w-full h-full border-0"
              allow="clipboard-write"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>

          {/* Barra de ações rápidas */}
          <div className={cn('p-2 border-t border-edge-muted flex gap-2', 'dark:border-edge-muted')}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                // Dispara evento para o construtor de código pegar o conteúdo
                window.dispatchEvent(
                  new CustomEvent('deepseek-panel-open', {
                    detail: { url: deepseekUrl },
                  }),
                );
              }}
            >
              <Icon name="file-copy" className="h-3.5 w-3.5" />
              <span className="text-xs hidden sm:inline">{t('chat.deepseekPanel.copyResponse')}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={togglePanel}
            >
              <Icon name="close" className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Quando fixado, o toggle fica no canto inferior direito */}
      {isPinned && (
        <Button
          ref={toggleRef}
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'fixed right-4 bottom-4 z-50 bg-blue-600 text-white shadow-lg rounded-full',
            'hover:bg-blue-500 transition-colors',
          )}
          aria-label={t('chat.deepseekPanel.closePanel')}
          onClick={() => setIsPinned(false)}
        >
          <Icon name="code" className="h-5 w-5 text-blue-50" />
        </Button>
      )}
    </>
  );
}
