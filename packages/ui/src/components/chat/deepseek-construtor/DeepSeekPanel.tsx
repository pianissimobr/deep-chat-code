import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icon/Icon';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useDeepSeekConstrutor } from './useDeepSeekConstrutor';
import { toast } from '@/components/ui';

const DEEPSEEK_URL = 'https://chat.deepseek.com';
const STORAGE_KEY = 'openchamber-deepseek-bridge:last-response';

type SimpleStatus = 'idle' | 'gerando-arvore' | 'executando' | 'sucesso' | 'erro';

export function DeepSeekPanel() {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [input, setInput] = useState('');
  const [statusText, setStatusText] = useState<string | null>(null);
  const [lastReceivedAt, setLastReceivedAt] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const currentSessionId = useSessionUIStore((s) => s.currentSessionId);
  const getDirectoryForSession = useSessionUIStore((s) => s.getDirectoryForSession);
  const diretorio = currentSessionId ? getDirectoryForSession(currentSessionId) : null;

  const { estado, gerarArvore, executar } = useDeepSeekConstrutor();
  const estadoStatus = estado.status as SimpleStatus;

  const togglePanel = useCallback(() => setIsOpen((prev) => !prev), []);

  const openDeepSeekInNewTab = useCallback(() => {
    try {
      const win = window.open(DEEPSEEK_URL, '_blank', 'noopener,noreferrer');
      if (!win) {
        toast.warning('Popup blocked. Open chat.deepseek.com manually.');
        return;
      }
      setStatusText(t('chat.deepseekPanel.statusWaitingBridge'));
    } catch {
      toast.warning('Could not open DeepSeek tab.');
    }
  }, [t]);

  const receiveBridgeText = useCallback((text: string) => {
    const trimmed = (text ?? '').trim();
    if (!trimmed) return;
    const when = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ text: trimmed, ts: when }));
    } catch {
      // storage may be unavailable in some embeds
    }
    setInput(trimmed);
    setLastReceivedAt(when);
    setStatusText(t('chat.deepseekPanel.statusReceived'));
    setIsOpen(true);
  }, [t]);

  useEffect(() => {
    // Poll the server's bridge endpoint every 3s: covers the GM_xmlhttpRequest
    // path where the userscript POSTs directly to the server (cross-tab).
    let stopped = false;
    const pollServer = async () => {
      try {
        const res = await fetch('/api/deepseek-construtor/ultima-resposta');
        if (!res.ok) return;
        const json = (await res.json()) as { ok?: boolean; text?: string | null; ts?: string | null };
        if (!json.ok || !json.text) return;
        if (json.ts && json.ts !== lastReceivedAt) {
          setInput((prev) => prev || json.text || '');
          setLastReceivedAt(json.ts);
          setStatusText(t('chat.deepseekPanel.statusReceived'));
        }
      } catch {
        // server down or route missing: postMessage/localStorage still work
      }
    };
    void pollServer();
    const id = setInterval(() => {
      if (!stopped) void pollServer();
    }, 3000);

    // Poll localStorage as a fallback if the tab that received the bridge text
    // is not this one (e.g. userscript wrote to localStorage from another tab).
    let lastSeen = '';
    const cleanupTimers = () => {
      stopped = true;
      clearInterval(id);
    };
    try {
      const rawInit = localStorage.getItem(STORAGE_KEY);
      if (rawInit) {
        try {
          const parsed = JSON.parse(rawInit) as { text?: string; ts?: string };
          if (parsed?.text) {
            setInput((prev) => prev || parsed.text || '');
            if (parsed.ts) setLastReceivedAt(parsed.ts);
          }
        } catch {
          setInput((prev) => prev || rawInit);
        }
        lastSeen = rawInit;
      }
    } catch {
      // ignore
    }

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { tipo?: string; text?: string; texto?: string } | null;
      if (!data || typeof data !== 'object') return;
      if (data.tipo === 'deepseek-resposta' && typeof data.text === 'string') {
        receiveBridgeText(data.text);
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const raw = event.newValue;
      if (!raw || raw === lastSeen) return;
      lastSeen = raw;
      try {
        const parsed = JSON.parse(raw) as { text?: string; ts?: string };
        if (parsed?.text) {
          setInput(parsed.text);
          if (parsed.ts) setLastReceivedAt(parsed.ts);
          setStatusText(t('chat.deepseekPanel.statusReceived'));
          setIsOpen(true);
        }
      } catch {
        setInput(raw);
        setStatusText(t('chat.deepseekPanel.statusReceived'));
      }
    };

    window.addEventListener('message', onMessage);
    window.addEventListener('storage', onStorage);
    return () => {
      cleanupTimers();
      window.removeEventListener('message', onMessage);
      window.removeEventListener('storage', onStorage);
    };
  }, [receiveBridgeText, t]);

  const construir = useCallback(async () => {
    const texto = input.trim();
    if (!texto) {
      toast.warning(t('chat.deepseekPanel.pastePlaceholder'));
      return;
    }
    if (!diretorio) {
      toast.warning(t('chat.deepseekPanel.noSession'));
      setStatusText(t('chat.deepseekPanel.noSession'));
      return;
    }
    setStatusText(estadoStatus === 'gerando-arvore' ? t('chat.messageBody.actions.construindo') : null);
    const caminho = await gerarArvore(diretorio);
    if (!caminho) return;
    const result = await executar(texto, caminho);
    if (result) {
      const stdout = result.stdout ?? '';
      const stderr = result.stderr ?? '';
      setOutput([stdout, stderr].filter(Boolean).join('\n') || null);
    }
  }, [diretorio, estadoStatus, executar, gerarArvore, input, t]);

  const limpar = useCallback(() => {
    setInput('');
    setOutput(null);
    setStatusText(null);
  }, []);

  const isBuilding = estadoStatus === 'executando' || estadoStatus === 'gerando-arvore';

  return (
    <>
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
          <Icon name="code" className="h-5 w-5" />
          <span className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-red-500 text-xs text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            🤖
          </span>
        </Button>
      )}

      {isOpen && (
        <div
          className={cn(
            'fixed top-0 right-0 h-full w-[26rem] max-w-[92vw] bg-surface-elevated border-l border-edge z-50 flex flex-col shadow-2xl',
            'dark:bg-surface-elevated',
          )}
        >
          <div className={cn('flex items-center justify-between p-4 border-b border-edge-muted', 'dark:border-edge-muted')}>
            <div className="flex items-center gap-2">
              <Icon name="code" className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span className="font-semibold text-foreground">DeepSeek Construtor</span>
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

          <div className="flex-1 overflow-auto p-4 space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t('chat.deepseekPanel.bridgeHint')}
            </p>

            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={openDeepSeekInNewTab}>
                <Icon name="file-copy" className="h-3.5 w-3.5 mr-1" />
                {t('chat.deepseekPanel.openDeepSeek')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={limpar}>
                {t('chat.deepseekPanel.clear')}
              </Button>
            </div>

            <div>
              <label className="text-xs font-medium text-foreground">
                {t('chat.deepseekPanel.copyResponse')}
              </label>
              <Textarea
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  if (e.target.value.trim()) setStatusText(null);
                }}
                placeholder={t('chat.deepseekPanel.pastePlaceholder')}
                className="mt-1 min-h-32 w-full text-xs"
                disabled={isBuilding}
              />
            </div>

            {lastReceivedAt && (
              <p className="text-[11px] text-muted-foreground">
                {t('chat.deepseekPanel.lastReceived')}: {new Date(lastReceivedAt).toLocaleString()}
              </p>
            )}

            {statusText && (
              <p className="text-xs text-muted-foreground">{statusText}</p>
            )}

            {!diretorio && (
              <p className="text-xs text-amber-600 dark:text-amber-400">{t('chat.deepseekPanel.noSession')}</p>
            )}
            {diretorio && (
              <p className="text-[11px] text-muted-foreground break-all">
                {t('chat.deepseekPanel.sessionDir')}: {diretorio}
              </p>
            )}

            {estado.mensagem && (
              <p className="text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap break-words">{estado.mensagem}</p>
            )}

            {output && (
              <div>
                <p className="text-xs font-medium text-foreground">{t('chat.deepseekPanel.output')}</p>
                <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed bg-muted/40 border border-edge-muted rounded-md p-3 max-h-64 overflow-auto">
                  {output}
                </pre>
              </div>
            )}
          </div>

          <div className={cn('p-3 border-t border-edge-muted flex gap-2', 'dark:border-edge-muted')}>
            <Button
              type="button"
              size="sm"
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white"
              onClick={() => void construir()}
              disabled={isBuilding || !input.trim()}
            >
              <Icon name="code" className="h-3.5 w-3.5 mr-1" />
              {isBuilding ? t('chat.deepseekPanel.building') : t('chat.deepseekPanel.build')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={togglePanel}>
              <Icon name="close" className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

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
