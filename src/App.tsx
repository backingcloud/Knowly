import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { anchorRect, readPick, type Pick } from './selection';
import { PENDING_CARDS_KEY, SETTINGS_KEY, PROVIDERS, remoteExplanationProvider, type KnowlySettings, type Explanation, type FollowUp } from './services/explanation';
import { ActionIcon, Appearance, paletteStyle, usePalette } from './CafeTheme';
import { downloadMarkdown, type LearningCard } from './services/cards';
import { copyText } from './platform/browser';

type ActiveCardSnapshot = {
  pick: Pick;
  result: Explanation;
  followUps: FollowUp[];
  note: string;
  contextEnabled: boolean;
  question: string;
  scroll: number;
  initialExpanded: boolean;
  expansions: Map<string, boolean>;
};

function makeCard(pick: Pick, explanation: Explanation, context: string | undefined, personalNote: string, followUps: FollowUp[]): LearningCard {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, term: pick.term, explanation, context, sourceTitle: document.title || location.hostname, sourceUrl: location.href, createdAt: new Date().toLocaleString(), personalNote, followUps };
}

function normalizeCardText(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function normalizeSourceUrl(value: string): string {
  try { const url = new URL(value); url.hash = ''; return url.href; }
  catch { return value; }
}

function matchesQueuedCard(card: LearningCard, term: string, sourceUrl: string, context?: string): boolean {
  return normalizeCardText(card.term) === normalizeCardText(term)
    && normalizeSourceUrl(card.sourceUrl) === normalizeSourceUrl(sourceUrl)
    // Older saved cards have no context; still let users update those cards.
    && (!card.context || !context || normalizeCardText(card.context) === normalizeCardText(context));
}

function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : <span key={index}>{part.replace(/\\([\\`*_{}\[\]()#+.!-])/g, '$1')}</span>,
  );
}

function highlightSelection(sentence: string, term: string) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return sentence.split(new RegExp(`(${escaped})`, 'giu')).map((part, index) =>
    index % 2 ? <strong key={index}>{part}</strong> : part,
  );
}

function FormattedAnswer({ text, resetKey = 0, expansionStore }: { text: string; resetKey?: number; expansionStore?: Map<string, boolean> }) {
  const [expanded, setExpanded] = useState(() => expansionStore?.get(text) ?? false);
  const [isLong, setIsLong] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const readingPosition = useRef<number | null>(null);
  useLayoutEffect(() => {
    const reading = body.current?.closest('.content');
    if (reading && readingPosition.current !== null) { reading.scrollTop = readingPosition.current; readingPosition.current = null; }
  }, [expanded]);
  useLayoutEffect(() => setExpanded(expansionStore?.get(text) ?? false), [resetKey, text, expansionStore]);
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    const measure = () => setIsLong(element.scrollHeight > 192);
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [text]);
  const normalized = text
    .replace(/\r/g, '')
    .replace(/\s+-\s+(?=\*\*)/g, '\n- ')
    .replace(/\s+(?=\*\*(?:这是什么|是什么|有什么用|用途|举个例子|例子|总结|注意事项|工作流程)[：:]?\*\*)/g, '\n\n');
  const lines = normalized.split('\n');
  const blocks: Array<{ type: 'p' | 'h' | 'li'; text: string; ordered?: boolean }> = [];
  let paragraph: string[] = [];
  const flush = () => { const value = paragraph.join(' ').trim(); if (value) blocks.push({ type: 'p', text: value }); paragraph = []; };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) { flush(); blocks.push({ type: 'h', text: heading[1]! }); continue; }
    const item = line.match(/^(?:[-*•]|(\d+)[.)])\s+(.*)$/);
    if (item) { flush(); blocks.push({ type: 'li', text: item[2]!, ordered: Boolean(item[1]) }); continue; }
    paragraph.push(line);
  }
  flush();
  return <div className="answer-section">
    <div ref={body} className={`formatted-answer${isLong && !expanded ? ' answer-collapsed' : ''}`}>{blocks.map((block, index) => {
    if (block.type === 'h') return <h4 key={index}>{renderInline(block.text.replace(/\*\*/g, ''))}</h4>;
    if (block.type === 'li') return <div className="answer-list-item" key={index}><span className="list-marker">{block.ordered ? '•' : '•'}</span><span>{renderInline(block.text)}</span></div>;
    return <p key={index}>{renderInline(block.text)}</p>;
    })}</div>
    {isLong && <button type="button" className="answer-toggle" aria-expanded={expanded} onClick={() => {
      const reading = body.current?.closest('.content');
      if (reading && body.current) {
        const offset = body.current.getBoundingClientRect().top - reading.getBoundingClientRect().top;
        readingPosition.current = expanded && offset < 0 ? Math.max(0, reading.scrollTop + offset - 8) : reading.scrollTop;
      }
      expansionStore?.set(text, !expanded); setExpanded(!expanded);
    }}><span>{expanded ? '收起回答' : '展开全文'}</span><span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span></button>}
  </div>;
}

export function App() {
  const [palette, setPalette] = usePalette();
  const [settings, setSettings] = useState<{ provider: KnowlySettings['provider']; model?: string } | null>(null);
  const [foldReset, setFoldReset] = useState(0);
  const answerExpansions = useRef(new Map<string, boolean>());
  const [pick, setPick] = useState<Pick | null>(null);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Explanation | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [contextEnabled, setContextEnabled] = useState(false);
  const [contextExpanded, setContextExpanded] = useState(false);
  const [termExpanded, setTermExpanded] = useState(false);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [initialExplanationExpanded, setInitialExplanationExpanded] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [pendingContext, setPendingContext] = useState<string | undefined>();
  const [question, setQuestion] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<LearningCard[]>([]);
  const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [cardSize, setCardSize] = useState<{ width: number; height: number } | null>(null);
  const [status, setStatus] = useState('');
  const [loaded, setLoaded] = useState(false);
  const retryAction = useRef<() => void>(() => {});
  const requestVersion = useRef(0);
  const skipNextExplain = useRef(false);
  const previousCard = useRef<ActiveCardSnapshot | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, visible: false });
  const cardScrollTop = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragStart = useRef<{ pointerX: number; pointerY: number; offsetX: number; offsetY: number } | null>(null);
  const cardResizeStart = useRef<{ pointerX: number; pointerY: number; width: number; height: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const latestTurnRef = useRef<HTMLDivElement>(null);
  const topbarRef = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const read = (value?: KnowlySettings) => {
      const provider = value?.provider && PROVIDERS[value.provider] ? value.provider : 'deepseek';
      setSettings({ provider, model: value?.credentials?.[provider]?.model || (provider === 'deepseek' ? value?.deepseekModel : '') || PROVIDERS[provider].defaultModel });
    };
    void browser.storage.local.get(SETTINGS_KEY).then(value => read(value[SETTINGS_KEY] as KnowlySettings));
    const listener: Parameters<typeof browser.storage.onChanged.addListener>[0] = (changes, area) => { if (area === 'local' && changes[SETTINGS_KEY]) read(changes[SETTINGS_KEY].newValue as KnowlySettings); };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => { browser.storage.local.get(PENDING_CARDS_KEY).then(value => {
    const cards = ((value as Record<string, LearningCard[]>)[PENDING_CARDS_KEY]) ?? [];
    setPending(cards); setLoaded(true);
  }); }, []);
  useEffect(() => { if (loaded) void browser.storage.local.set({ [PENDING_CARDS_KEY]: pending }); }, [pending, loaded]);
  useEffect(() => { setContextExpanded(false); setTermExpanded(false); }, [pick?.term, pick?.context]);
  const close = () => { requestVersion.current++; setBusy(false); setOpen(false); setPick(null); setQueueOpen(false); setEditingQueuedId(null); previousCard.current = null; };
  const openQueueView = () => {
    cardScrollTop.current = contentRef.current?.scrollTop ?? 0;
    setQueueOpen(true);
  };
  const restorePreviousCard = (updated: boolean) => {
    const previous = previousCard.current;
    if (!previous) return false;
    previousCard.current = null;
    skipNextExplain.current = true;
    setPick(previous.pick); setResult(previous.result); setStreamingText('');
    setFollowUps(previous.followUps); setNote(previous.note); setContextEnabled(previous.contextEnabled);
    setQuestion(previous.question); setPendingQuestion(null); setError('');
    answerExpansions.current = previous.expansions;
    cardScrollTop.current = previous.scroll;
    setInitialExplanationExpanded(previous.initialExpanded);
    setEditingQueuedId(null); setQueueOpen(false); setOpen(true);
    setStatus(updated ? '已更新待保存卡片，已返回当前关键词。' : '已返回刚才的学习卡。');
    return true;
  };
  const returnToCard = () => { if (!restorePreviousCard(false)) setQueueOpen(false); };

  const startDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    dragStart.current = { pointerX: event.clientX, pointerY: event.clientY, offsetX: dragOffset.x, offsetY: dragOffset.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const start = dragStart.current;
    if (!start || !panel.current) return;
    const minX = 8 - position.left;
    const minY = 8 - position.top;
    const maxX = Math.max(8, innerWidth - panel.current.offsetWidth - 8) - position.left;
    const maxY = Math.max(8, innerHeight - panel.current.offsetHeight - 8) - position.top;
    setDragOffset({
      x: Math.min(maxX, Math.max(minX, start.offsetX + event.clientX - start.pointerX)),
      y: Math.min(maxY, Math.max(minY, start.offsetY + event.clientY - start.pointerY)),
    });
  };
  const stopDrag = () => { dragStart.current = null; };
  const startCardResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault(); event.stopPropagation();
    if (!cardRef.current) return;
    cardResizeStart.current = { pointerX: event.clientX, pointerY: event.clientY, width: cardRef.current.offsetWidth, height: cardRef.current.offsetHeight };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveCardResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = cardResizeStart.current;
    if (!start || !panel.current) return;
    const minWidth = Math.min(320, innerWidth - 16);
    const minHeight = Math.min(560, innerHeight - 16);
    const width = Math.max(minWidth, Math.min(innerWidth - 16, start.width + event.clientX - start.pointerX));
    const height = Math.max(minHeight, Math.min(innerHeight - 16, start.height + event.clientY - start.pointerY));
    setCardSize({ width, height });
    const rect = panel.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, innerWidth - width - 8));
    const top = Math.max(8, Math.min(rect.top, innerHeight - height - 8));
    setDragOffset({ x: left - position.left, y: top - position.top });
  };
  const stopCardResize = () => { cardResizeStart.current = null; };

  useEffect(() => {
    let frame = 0;
    const inside = (event: Event) => {
      const path = event.composedPath();
      return Boolean(panel.current && path.includes(panel.current)) || path.some(node =>
        typeof node === 'object' && node !== null && 'localName' in node && (node as Element).localName === 'knowly-ui',
      );
    };
    const update = (event: Event) => {
      if (inside(event)) return;
      // Keep the open card and its unsaved note safe. Close it explicitly or use “加入并继续选”.
      if (open) return;
      if (event instanceof KeyboardEvent && !['Shift', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = readPick();
        setPick(next); setDragOffset({ x: 0, y: 0 }); setOpen(false); setResult(null); setFollowUps([]); setPendingQuestion(null); setQuestion(''); setNote(''); setContextEnabled(false); setError(''); setStatus(''); setEditingQueuedId(null);
      });
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { cancelAnimationFrame(frame); close(); } };
    document.addEventListener('pointerup', update); document.addEventListener('keyup', update); document.addEventListener('keydown', escape);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('pointerup', update); document.removeEventListener('keyup', update); document.removeEventListener('keydown', escape); };
  }, [open]);

  useLayoutEffect(() => {
    if (!pick) return;
    let frame = 0;
    const place = () => {
      const rect = anchorRect(pick);
      if (!rect) { setPosition(p => ({ ...p, visible: open ? true : false })); return; }
      const width = panel.current?.offsetWidth ?? 90;
      const height = panel.current?.offsetHeight ?? 36;
      const left = Math.max(8, Math.min(rect.left, innerWidth - width - 8));
      const top = rect.bottom + height + 10 <= innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - height - 8);
      setPosition({ left, top, visible: true });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    place(); window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
    const observer = new ResizeObserver(schedule); if (panel.current) observer.observe(panel.current);
    const mutations = new MutationObserver(schedule); mutations.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); mutations.disconnect(); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); };
  }, [pick, open, result, error, followUps.length, queueOpen]);

  useLayoutEffect(() => {
    const container = contentRef.current;
    const target = latestTurnRef.current;
    if (!container || !target) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (!pendingQuestion) return;
    const top = container.scrollTop + targetRect.top - containerRect.top - 10;
    container.scrollTo({ top: Math.max(0, top) });
  }, [pendingQuestion]);
  useLayoutEffect(() => {
    if (!queueOpen && !editingQueuedId && cardScrollTop.current !== null && contentRef.current) {
      contentRef.current.scrollTop = cardScrollTop.current;
      cardScrollTop.current = null;
    }
  }, [queueOpen, editingQueuedId]);
  useLayoutEffect(() => { if (contentRef.current && cardScrollTop.current === null && !skipNextExplain.current) contentRef.current.scrollTop = 0; }, [pick?.term, pick?.context]);

  const explain = async (withContext = contextEnabled) => {
    if (!pick) return;
    const version = ++requestVersion.current;
    retryAction.current = () => { void explain(withContext); };
    setBusy(true); setError(''); setResult(null); setStreamingText(''); setFollowUps([]); setPendingQuestion(null); setStatus('');
    try {
      const explanation = await remoteExplanationProvider.explain(pick.term, withContext ? pick.context : undefined, chunk => { if (version === requestVersion.current) setStreamingText(value => value + chunk); });
      if (version === requestVersion.current) setResult(explanation);
    }
    catch (e) { if (version === requestVersion.current) setError(e instanceof Error ? e.message : '解释失败，请重试。'); }
    finally { if (version === requestVersion.current) setBusy(false); }
  };
  useEffect(() => {
    if (!open || !pick) return;
    closeButton.current?.focus({ preventScroll: true });
    if (skipNextExplain.current) { skipNextExplain.current = false; return; }
    void explain(false);
    // The initial request intentionally sends no context; the user opts in below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pick]);

  const toggleContext = (enabled: boolean) => { setContextEnabled(enabled); };
  const runFollowUp = async (asked: string) => {
    if (!pick || !result || !asked.trim() || busy) return;
    const version = ++requestVersion.current;
    answerExpansions.current.clear(); setFoldReset(value => value + 1); setInitialExplanationExpanded(false);
    const contextSent = contextEnabled ? pick.context : undefined;
    setPendingContext(contextSent);
    setQuestion(''); setPendingQuestion(asked); setBusy(true); setError(''); setStatus('');
    retryAction.current = () => { void runFollowUp(asked); };
    try {
      const answer = await remoteExplanationProvider.followUp(pick.term, contextSent, result, followUps, asked);
      if (version !== requestVersion.current) return;
      setFollowUps(value => [...value, { question: asked, answer, ...(contextSent ? { contextSent } : {}) }]);
      setPendingQuestion(null);
    } catch (e) { if (version === requestVersion.current) { setPendingQuestion(null); setQuestion(asked); setError(e instanceof Error ? e.message : '追问失败，请重试。'); } }
    finally { if (version === requestVersion.current) setBusy(false); }
  };
  const askFollowUp = (event: React.FormEvent) => { event.preventDefault(); if (question.trim()) void runFollowUp(question.trim()); };
  const returnToQueue = () => setQueueOpen(true);
  const editQueuedCard = (card: LearningCard) => {
    if (!pick) return;
    if (!previousCard.current && result) previousCard.current = {
      pick, result, followUps: [...followUps], note, contextEnabled, question,
      scroll: cardScrollTop.current ?? contentRef.current?.scrollTop ?? 0, initialExpanded: initialExplanationExpanded,
      expansions: answerExpansions.current,
    };
    answerExpansions.current = new Map();
    skipNextExplain.current = true;
    setEditingQueuedId(card.id);
    setPick({ term: card.term, context: card.context, range: pick.range });
    setResult(card.explanation); setStreamingText(''); setFollowUps(card.followUps ?? []);
    setPendingQuestion(null); setQuestion(''); setNote(card.personalNote ?? '');
    setContextEnabled(false); setError(''); setStatus('可查看内容；修改后点击“更新待保存”保存。');
    setOpen(true); setQueueOpen(false); setInitialExplanationExpanded(false);
  };
  const currentCard = (existing?: LearningCard) => {
    if (!pick || !result) return null;
    const card = makeCard(pick, result, pick.context, note, followUps);
    return existing ? { ...card, id: existing.id, createdAt: existing.createdAt, sourceTitle: existing.sourceTitle, sourceUrl: existing.sourceUrl } : card;
  };
  const addToQueue = () => {
    if (!pick || !result) return;
    if (editingQueuedId) {
      const existing = pending.find(card => card.id === editingQueuedId);
      if (!existing) { setError('这张卡片已从待保存清单中移除。'); setEditingQueuedId(null); setQueueOpen(true); return; }
      const card = currentCard(existing);
      if (!card) return;
      setPending(items => items.map(item => item.id === existing.id ? card : item));
      setStatus(previousCard.current
        ? `已更新待保存卡片。可返回原学习卡「${previousCard.current.pick.term}」。`
        : '已更新待保存卡片，追问和笔记已同步。');
      return;
    }
    const context = pick.context;
    const existing = pending.find(card => matchesQueuedCard(card, pick.term, location.href, context));
    const card = makeCard(pick, result, context, note, followUps);
    if (existing) {
      setPending(items => items.map(item => matchesQueuedCard(item, pick.term, location.href, context)
        ? { ...card, id: item.id, createdAt: item.createdAt }
        : item));
      setStatus('已更新清单中的卡片，笔记和追问已同步。');
      return;
    }
    setPending(items => [...items, card]); setStatus('已加入待保存清单。');
  };
  const addAndContinue = () => {
    if (!pick || !result) return;
    const context = pick.context;
    const editingExisting = editingQueuedId ? pending.find(item => item.id === editingQueuedId) : undefined;
    const card = currentCard(editingExisting);
    if (!card) return;
    if (editingQueuedId && !editingExisting) { setError('这张卡片已从待保存清单中移除。'); setEditingQueuedId(null); setQueueOpen(true); return; }
    const existing = pending.find(item => matchesQueuedCard(item, pick.term, location.href, context));
    if (editingExisting) {
      setPending(items => items.map(item => item.id === editingExisting.id ? card : item));
    } else if (existing) {
      setPending(items => items.map(item => matchesQueuedCard(item, pick.term, location.href, context)
        ? { ...card, id: item.id, createdAt: item.createdAt }
        : item));
    } else setPending(items => [...items, card]);
    setQueueOpen(false); setOpen(false); setPick(null); setEditingQueuedId(null); previousCard.current = null;
  };
  const saveOne = () => {
    if (!pick || !result) return;
    const existing = editingQueuedId ? pending.find(card => card.id === editingQueuedId) : undefined;
    const card = currentCard(existing);
    if (!card) return;
    try { downloadMarkdown([card]); setStatus('Markdown 卡片已生成，请查看浏览器下载内容。'); }
    catch { setStatus('文件生成失败，请稍后重试。'); }
  };
  const exportAll = () => {
    if (!pending.length) return;
    try { downloadMarkdown(pending); setStatus('已生成合并 Markdown 文件；清单暂时保留，确认下载后可手动清空。'); }
    catch { setStatus('文件生成失败，待保存清单仍保留。'); }
  };
  const copy = async () => {
    if (!pick || !result) return;
    try { await copyText(`${pick.term}\n解释：${result.definition}${result.usage ? `\n用途：${result.usage}` : ''}${result.example ? `\n例子：${result.example}` : ''}`); setStatus('解释已复制。'); }
    catch { setStatus('复制失败，可以手动选择文字复制。'); }
  };

  if (!pick) return null;
  const returnCardTerm = previousCard.current?.pick.term ?? pick.term;
  const alreadyQueued = Boolean(editingQueuedId || (result && pending.some(card => matchesQueuedCard(card, pick.term, location.href, pick.context))));
  const providerLabel = settings ? PROVIDERS[settings.provider].label : 'AI 模型';
  return <div ref={panel} className="floating" style={{ left: position.left + dragOffset.x, top: position.top + dragOffset.y, visibility: position.visible ? 'visible' : 'hidden' }}>
    {!open ? <button className="trigger" onPointerDown={e => e.preventDefault()} onClick={() => { setOpen(true); setQueueOpen(false); }} aria-label="解释选中文字">解释</button> :
      <section ref={cardRef} data-palette={palette} className={`card${queueOpen ? ' queue-expanded' : ''}`} style={{ ...paletteStyle(palette), ...(cardSize ? { width: cardSize.width, height: cardSize.height } : {}) }} role="dialog" aria-modal="false" aria-label={queueOpen ? '待保存清单' : undefined} aria-labelledby={queueOpen ? undefined : 'knowly-title'}>
        <div className="card-topbar" ref={topbarRef}>
        <header className="card-header" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
          <span className="brand">✦ Knowly</span><span className="badge" title={`后续请求使用：${providerLabel}${settings?.model ? ` · ${settings.model}` : ''}`}>{providerLabel}</span><span className="drag-hint">拖动</span><Appearance palette={palette} onChange={setPalette} /><button ref={closeButton} className="close" onClick={close} aria-label="关闭解释">×</button>
        </header>
        <nav className="view-tabs" aria-label="学习卡页面"><button type="button" aria-pressed={!queueOpen} onClick={() => setQueueOpen(false)}>学习卡</button><button type="button" className="queue-toggle" aria-pressed={queueOpen} onClick={openQueueView}>待保存清单 <span>{pending.length}</span></button>{(queueOpen || previousCard.current) && <button type="button" className="queue-return" disabled={busy} title={`返回最初选择的「${returnCardTerm}」学习卡，保留笔记和阅读位置`} onClick={returnToCard}>返回「{returnCardTerm}」学习卡</button>}</nav>
        <section className="topic-header" aria-label="当前学习内容" hidden={queueOpen}>
          {editingQueuedId && <div className="update-kicker">查看学习卡「{pick.term}」</div>}
          <div className={`topic-title-row${termExpanded ? ' is-expanded' : ''}`}><h2 id="knowly-title">{pick.term}</h2>{pick.term.length > 42 && <button type="button" onClick={() => setTermExpanded(value => !value)}>{termExpanded ? '收起' : '展开'}</button>}</div>
          {pick.context && <div className={`topic-context${contextExpanded ? ' is-expanded' : ''}`}><span>原句</span><p title={pick.context}>{highlightSelection(pick.context, pick.term)}</p>{pick.context.length > 72 && <button type="button" onClick={() => setContextExpanded(value => !value)}>{contextExpanded ? '收起' : '展开'}</button>}</div>}
          {pick.context && <label className="context-toggle" title="仅影响之后的追问请求，不重新生成已有解释或清空追问。取消勾选后，后续请求不再附带原句。"><input type="checkbox" checked={contextEnabled} onChange={event => toggleContext(event.target.checked)} />下次追问附带原句</label>}
          <div className="cat-buddy"><img src={browser.runtime.getURL('/cat-study-mascot.png')} alt="趴在书本上学习的小猫" /><span><b>小橘的自习时间</b><small>今天也学一点点 ✦</small></span></div>
        </section>
        </div>
        <div className="queue-screen" aria-label="待保存清单" hidden={!queueOpen}>
          <div className="queue-screen-toolbar"><span>跨网页保留，直到你主动移除或清空。</span><button className="queue-export" title="导出清单内所有卡片的解释、追问和笔记" disabled={!pending.length} onClick={exportAll}>合并导出</button><button className="queue-clear" disabled={!pending.length || busy} onClick={() => { if (window.confirm(`确定清空待保存清单中的 ${pending.length} 张学习卡吗？此操作无法撤销。如需保留，请先合并导出并确认文件无误。`)) setPending([]); }}>清空</button></div>
          <div className="queue-list">
            {!pending.length ? <p className="queue-empty">清单为空。返回学习卡后可加入新卡片。</p> : pending.map(card => <div className="queue-item" key={card.id}><span className="queue-term">{card.term}<small>{new URL(card.sourceUrl).hostname}</small></span><div className="queue-item-actions"><button disabled={busy} className="queue-edit" aria-label={`查看并更新 ${card.term}`} title="打开查看；修改后点击更新待保存才会写入清单" onClick={() => editQueuedCard(card)}>查看并更新</button><button disabled={busy} className="queue-remove" aria-label={`移除 ${card.term}`} onClick={() => setPending(items => items.filter(item => item.id !== card.id))}>移除</button></div></div>)}
          </div>
          <small className="queue-note">返回学习卡会恢复刚才的追问位置。导出后清单会保留。</small>
        </div>
        <div className="card-body" hidden={queueOpen}>
        <div ref={contentRef} className="content">

          {busy && <p role="status">模型正在生成，内容会逐步显示…</p>}
          {error && <div className="error" role="alert"><p>{error}</p><button onClick={() => retryAction.current()}>重试</button></div>}
          {streamingText && !result && <><h3>通俗解释</h3><FormattedAnswer expansionStore={answerExpansions.current} resetKey={foldReset} text={streamingText} /></>}
          {result && <>
            {followUps.length > 0 ? <details className="initial-explanation" open={initialExplanationExpanded} onToggle={event => setInitialExplanationExpanded(event.currentTarget.open)}>
              <summary>{initialExplanationExpanded ? '收起初始解释' : '查看初始解释'}</summary>
              <h3>通俗解释</h3><FormattedAnswer expansionStore={answerExpansions.current} resetKey={foldReset} text={result.definition} />{result.usage && <><h3>用途</h3><FormattedAnswer expansionStore={answerExpansions.current} resetKey={foldReset} text={result.usage} /></>}{result.example && <><h3>举个例子</h3><FormattedAnswer expansionStore={answerExpansions.current} resetKey={foldReset} text={result.example} /></>}
            </details> : <><h3>通俗解释</h3><FormattedAnswer expansionStore={answerExpansions.current} resetKey={foldReset} text={result.definition} />{result.usage && <><h3>用途</h3><FormattedAnswer expansionStore={answerExpansions.current} resetKey={foldReset} text={result.usage} /></>}{result.example && <><h3>举个例子</h3><FormattedAnswer expansionStore={answerExpansions.current} resetKey={foldReset} text={result.example} /></>}</>}
            {followUps.map((turn, index) => <div className="turn" key={`${index}-${turn.question}`} ref={index === followUps.length - 1 && !pendingQuestion ? latestTurnRef : undefined}>
              <div className="user-bubble"><span>你</span><FormattedAnswer expansionStore={answerExpansions.current} resetKey={foldReset} text={turn.question} />{turn.contextSent && <details className="sent-context"><summary>已附带原句 · 查看</summary><p>{turn.contextSent}</p></details>}</div>
              <div className="assistant-bubble"><span>Knowly</span><FormattedAnswer expansionStore={answerExpansions.current} resetKey={foldReset} text={turn.answer} /></div>
            </div>)}
            {pendingQuestion && <div className="turn pending-turn" ref={latestTurnRef}><div className="user-bubble"><span>你</span><FormattedAnswer expansionStore={answerExpansions.current} resetKey={foldReset} text={pendingQuestion} />{pendingContext && <details className="sent-context"><summary>本次请求附带原句 · 查看</summary><p>{pendingContext}</p></details>}</div><div className="assistant-bubble"><span>Knowly</span><p role="status">正在生成回答…</p></div></div>}
          </>}
        </div>
        {result && <div className="follow-composer"><label className="follow-label" htmlFor="follow-up-question">继续追问</label>{contextEnabled && pick.context && <p className="context-send-hint">本次追问将附带上方原句，不会重新解释。</p>}<form className="follow-form" onSubmit={askFollowUp}><input id="follow-up-question" value={question} onChange={event => setQuestion(event.target.value)} placeholder="输入你想继续了解的问题" aria-label="输入追问内容" /><button disabled={busy || !question.trim()}>追问</button></form></div>}
        {result && <section className="note-panel"><label className="note-label" htmlFor="personal-note">我的笔记</label><textarea id="personal-note" value={note} onChange={event => setNote(event.target.value)} placeholder="记下自己的理解或补充…" rows={2} /></section>}
        <footer className="card-actions">
          <div className="action-row action-row-utility"><button title="仅复制完整的初始解释，不包含追问和笔记" className="action-copy" disabled={!result} onClick={copy}><ActionIcon name="copy" /><span>复制初始解释</span></button><button title="下载 Markdown：包含初始解释、全部追问和我的笔记" className="action-secondary" disabled={!result || busy} onClick={saveOne}><ActionIcon name="download" /><span>保存 Markdown</span></button></div>
          <div className="action-row action-row-main"><button title="保存初始解释、全部追问和我的笔记到待保存清单" className="action-primary" disabled={!result || busy} onClick={addToQueue}><ActionIcon name={alreadyQueued ? 'update' : 'save'} /><span>{alreadyQueued ? '更新待保存' : '加入待保存'}</span></button><button title="保存解释、全部追问和笔记，然后关闭弹窗继续在网页选词" className="action-continue" disabled={!result || busy} onClick={addAndContinue}><ActionIcon name="next" /><span>{alreadyQueued ? '更新并继续选词' : '加入并继续选词'}</span></button></div>
          <span className="action-status" role="status">{status || (result ? '解释、笔记和追问会一起保存' : '仅发送所选文字')}</span>
        </footer>
        </div>
        <div className="card-resize" role="group" aria-label="拖动调整卡片大小" title="拖动调整卡片大小" onPointerDown={startCardResize} onPointerMove={moveCardResize} onPointerUp={stopCardResize} onPointerCancel={stopCardResize}><span /></div>
      </section>}
  </div>;
}
