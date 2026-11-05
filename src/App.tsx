import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { anchorRect, readPick, type Pick } from './selection';
import { PENDING_CARDS_KEY, remoteExplanationProvider, type Explanation, type FollowUp } from './services/explanation';
import { downloadMarkdown, type LearningCard } from './services/cards';
import { copyText } from './platform/browser';

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
    && normalizeCardText(card.context) === normalizeCardText(context);
}

function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : <span key={index}>{part.replace(/\\([\\`*_{}\[\]()#+.!-])/g, '$1')}</span>,
  );
}

function FormattedAnswer({ text }: { text: string }) {
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
    if (heading) { flush(); blocks.push({ type: 'h', text: heading[1] }); continue; }
    const item = line.match(/^(?:[-*•]|(\d+)[.)])\s+(.*)$/);
    if (item) { flush(); blocks.push({ type: 'li', text: item[2], ordered: Boolean(item[1]) }); continue; }
    paragraph.push(line);
  }
  flush();
  return <div className="formatted-answer">{blocks.map((block, index) => {
    if (block.type === 'h') return <h4 key={index}>{renderInline(block.text.replace(/\*\*/g, ''))}</h4>;
    if (block.type === 'li') return <div className="answer-list-item" key={index}><span className="list-marker">{block.ordered ? '•' : '•'}</span><span>{renderInline(block.text)}</span></div>;
    return <p key={index}>{renderInline(block.text)}</p>;
  })}</div>;
}

export function App() {
  const [pick, setPick] = useState<Pick | null>(null);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Explanation | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [contextEnabled, setContextEnabled] = useState(false);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<LearningCard[]>([]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueHeight, setQueueHeight] = useState(230);
  const [cardSize, setCardSize] = useState<{ width: number; height: number } | null>(null);
  const [status, setStatus] = useState('');
  const [loaded, setLoaded] = useState(false);
  const retryAction = useRef<() => void>(() => {});
  const [position, setPosition] = useState({ left: 0, top: 0, visible: false });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragStart = useRef<{ pointerX: number; pointerY: number; offsetX: number; offsetY: number } | null>(null);
  const queueResizeStart = useRef<{ pointerY: number; height: number } | null>(null);
  const cardResizeStart = useRef<{ pointerX: number; pointerY: number; width: number; height: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const latestTurnRef = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => { browser.storage.local.get(PENDING_CARDS_KEY).then(value => {
    const cards = ((value as Record<string, LearningCard[]>)[PENDING_CARDS_KEY]) ?? [];
    setPending(cards); setQueueOpen(cards.length > 0); setLoaded(true);
  }); }, []);
  useEffect(() => { if (loaded) void browser.storage.local.set({ [PENDING_CARDS_KEY]: pending }); }, [pending, loaded]);
  const close = () => { setOpen(false); setPick(null); setQueueOpen(false); };

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
  const startQueueResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    queueResizeStart.current = { pointerY: event.clientY, height: queueHeight };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveQueueResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = queueResizeStart.current;
    if (!start) return;
    const card = event.currentTarget.closest('.card');
    const maxByWindow = Math.max(130, innerHeight - 220);
    const maxByCard = card ? Math.max(130, card.clientHeight - 300) : maxByWindow;
    const max = Math.min(460, maxByWindow, maxByCard);
    setQueueHeight(Math.max(130, Math.min(max, start.height + start.pointerY - event.clientY)));
  };
  const stopQueueResize = () => { queueResizeStart.current = null; };
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
    const minHeight = Math.min(400, innerHeight - 16);
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
        setPick(next); setDragOffset({ x: 0, y: 0 }); setOpen(false); setResult(null); setFollowUps([]); setPendingQuestion(null); setQuestion(''); setNote(''); setContextEnabled(false); setError(''); setStatus('');
      });
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { cancelAnimationFrame(frame); setOpen(false); setPick(null); } };
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
    const top = container.scrollTop + targetRect.top - containerRect.top - 12;
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [pendingQuestion, followUps.length]);

  const explain = async (withContext = contextEnabled) => {
    if (!pick) return;
    retryAction.current = () => { void explain(withContext); };
    setBusy(true); setError(''); setResult(null); setStreamingText(''); setFollowUps([]); setPendingQuestion(null); setStatus('');
    try { setResult(await remoteExplanationProvider.explain(pick.term, withContext ? pick.context : undefined, chunk => setStreamingText(value => value + chunk))); }
    catch (e) { setError(e instanceof Error ? e.message : '解释失败，请重试。'); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!open || !pick) return;
    closeButton.current?.focus({ preventScroll: true });
    void explain(false);
    // The initial request intentionally sends no context; the user opts in below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pick]);

  const toggleContext = async (enabled: boolean) => { setContextEnabled(enabled); await explain(enabled); };
  const runFollowUp = async (asked: string) => {
    if (!pick || !result || !asked.trim() || busy) return;
    setQuestion(''); setPendingQuestion(asked); setBusy(true); setError(''); setStatus('');
    retryAction.current = () => { void runFollowUp(asked); };
    try {
      const answer = await remoteExplanationProvider.followUp(pick.term, contextEnabled ? pick.context : undefined, result, followUps, asked);
      setFollowUps(value => [...value, { question: asked, answer }]);
      setPendingQuestion(null);
    } catch (e) { setPendingQuestion(null); setQuestion(asked); setError(e instanceof Error ? e.message : '追问失败，请重试。'); }
    finally { setBusy(false); }
  };
  const askFollowUp = (event: React.FormEvent) => { event.preventDefault(); if (question.trim()) void runFollowUp(question.trim()); };
  const addToQueue = () => {
    if (!pick || !result) return;
    const context = contextEnabled ? pick.context : undefined;
    const existing = pending.find(card => matchesQueuedCard(card, pick.term, location.href, context));
    const card = makeCard(pick, result, context, note, followUps);
    if (existing) {
      setPending(items => items.map(item => matchesQueuedCard(item, pick.term, location.href, context)
        ? { ...card, id: item.id, createdAt: item.createdAt }
        : item));
      setStatus('已更新清单中的卡片，笔记和追问已同步。');
      setQueueOpen(true);
      return;
    }
    setPending(items => [...items, card]); setStatus('已加入待保存清单。');
    setQueueOpen(true);
  };
  const addAndContinue = () => {
    if (!pick || !result) return;
    const context = contextEnabled ? pick.context : undefined;
    const card = makeCard(pick, result, context, note, followUps);
    const existing = pending.find(item => matchesQueuedCard(item, pick.term, location.href, context));
    if (existing) {
      setPending(items => items.map(item => matchesQueuedCard(item, pick.term, location.href, context)
        ? { ...card, id: item.id, createdAt: item.createdAt }
        : item));
    } else setPending(items => [...items, card]);
    setQueueOpen(true); setOpen(false); setPick(null);
  };
  const saveOne = () => {
    if (!pick || !result) return;
    try { downloadMarkdown([makeCard(pick, result, contextEnabled ? pick.context : undefined, note, followUps)]); setStatus('Markdown 卡片已生成，请查看浏览器下载内容。'); }
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
  const alreadyQueued = Boolean(result && pending.some(card => matchesQueuedCard(card, pick.term, location.href, contextEnabled ? pick.context : undefined)));
  const providerLabel = result?.provider ? (result.provider === 'zhipu' ? '智谱 GLM' : result.provider === 'doubao' ? '豆包' : 'DeepSeek') : 'AI 模型';
  return <div ref={panel} className="floating" style={{ left: position.left + dragOffset.x, top: position.top + dragOffset.y, visibility: position.visible ? 'visible' : 'hidden' }}>
    {!open ? <button className="trigger" onPointerDown={e => e.preventDefault()} onClick={() => { setOpen(true); if (pending.length) setQueueOpen(true); }} aria-label="解释选中文字">解释</button> :
      <section ref={cardRef} className={`card${queueOpen ? ' queue-expanded' : ''}`} style={cardSize ? { width: cardSize.width, height: cardSize.height } : undefined} role="dialog" aria-modal="false" aria-labelledby="knowly-title">
        <header className="card-header" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
          <span className="brand">✦ Knowly</span><span className="badge">{providerLabel}</span><span className="drag-hint">拖动</span><button ref={closeButton} className="close" onClick={close} aria-label="关闭解释">×</button>
        </header>
        <div ref={contentRef} className="content"><p className="eyebrow">把好奇，变成理解</p><h2 id="knowly-title">{pick.term}</h2>
          {pick.context && <label className="context-toggle"><input type="checkbox" checked={contextEnabled} onChange={event => void toggleContext(event.target.checked)} />同时发送所在句子 <span>默认关闭</span></label>}
          {contextEnabled && pick.context && <blockquote className="context-preview">{pick.context}</blockquote>}
          {busy && <p role="status">模型正在生成，内容会逐步显示…</p>}
          {error && <div className="error" role="alert"><p>{error}</p><button onClick={() => retryAction.current()}>重试</button></div>}
          {streamingText && !result && <><h3>通俗解释</h3><FormattedAnswer text={streamingText} /></>}
          {result && <><h3>通俗解释</h3><FormattedAnswer text={result.definition} />{result.usage && <><h3>用途</h3><FormattedAnswer text={result.usage} /></>}{result.example && <><h3>举个例子</h3><FormattedAnswer text={result.example} /></>}
            {followUps.map((turn, index) => <div className="turn" key={`${index}-${turn.question}`} ref={index === followUps.length - 1 && !pendingQuestion ? latestTurnRef : undefined}>
              <div className="user-bubble"><span>你</span><p>{turn.question}</p></div>
              <div className="assistant-bubble"><span>Knowly</span><FormattedAnswer text={turn.answer} /></div>
            </div>)}
            {pendingQuestion && <div className="turn pending-turn" ref={latestTurnRef}><div className="user-bubble"><span>你</span><p>{pendingQuestion}</p></div><div className="assistant-bubble"><span>Knowly</span><p role="status">正在生成回答…</p></div></div>}
            <form className="follow-form" onSubmit={askFollowUp}><input value={question} onChange={event => setQuestion(event.target.value)} placeholder="继续问：能举个工作中的例子吗？" aria-label="继续追问" /><button disabled={busy || !question.trim()}>追问</button></form>
            <label className="note-label" htmlFor="personal-note">我的笔记</label><textarea id="personal-note" value={note} onChange={event => setNote(event.target.value)} placeholder="记下自己的理解或补充…" rows={3} />
          </>}
        </div>
        <footer className="card-actions"><button disabled={!result} onClick={copy}>复制</button><button disabled={!result} onClick={saveOne}>保存 Markdown</button><button disabled={!result} onClick={addToQueue}>{alreadyQueued ? '更新待保存' : '加入待保存'}</button><button disabled={!result} onClick={addAndContinue}>{alreadyQueued ? '更新并继续选' : '加入并继续选'}</button><button onClick={() => setQueueOpen(v => !v)}>待保存 {pending.length}</button><span role="status">{status || (result ? '可继续追问、加笔记或保存' : '仅发送所选文字')}</span></footer>
        {queueOpen && <>
          <div className="queue-resizer" role="separator" aria-orientation="horizontal" aria-label="拖动调整待保存清单高度" title="上下拖动调整清单高度" onPointerDown={startQueueResize} onPointerMove={moveQueueResize} onPointerUp={stopQueueResize} onPointerCancel={stopQueueResize}><span /></div>
          <div className="queue" style={{ height: queueHeight }}>
            <div className="queue-head"><strong>待保存清单 <span>({pending.length})</span></strong><div><button disabled={!pending.length} onClick={exportAll}>合并导出</button><button disabled={!pending.length} onClick={() => setPending([])}>清空</button></div></div>
            <div className="queue-list">
              {!pending.length ? <p className="queue-empty">清单为空。解释后点“加入待保存”。</p> : pending.map(card => <div className="queue-item" key={card.id}><span className="queue-term">{card.term}<small>{new URL(card.sourceUrl).hostname}</small></span><button aria-label={`移除 ${card.term}`} onClick={() => setPending(items => items.filter(item => item.id !== card.id))}>移除</button></div>)}
            </div>
            <small className="queue-note">导出后清单会保留；确认下载完成后再清空。</small>
          </div>
        </>}
        <div className="card-resize" role="group" aria-label="拖动调整卡片大小" title="拖动调整卡片大小" onPointerDown={startCardResize} onPointerMove={moveCardResize} onPointerUp={stopCardResize} onPointerCancel={stopCardResize}><span /></div>
      </section>}
  </div>;
}
