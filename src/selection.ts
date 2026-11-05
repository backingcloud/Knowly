export interface Pick { term: string; range: Range; context?: string }
const excluded = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],knowly-ui';
export function readPick(): Pick | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const term = selection.toString().trim().replace(/\s+/g, ' ');
  if (!term || term.length > 200) return null;
  const range = selection.getRangeAt(0).cloneRange();
  const element = (node: Node) => node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  if ([range.startContainer, range.endContainer, range.commonAncestorContainer].some(node => element(node)?.closest(excluded))) return null;
  if (element(range.startContainer)?.getRootNode() !== document || element(range.endContainer)?.getRootNode() !== document) return null;
  const start = element(range.startContainer);
  const block = start?.closest('p,li,blockquote,td,th,dd,dt,h1,h2,h3,h4,h5,h6') ?? start;
  const text = (block?.textContent ?? '').replace(/\s+/g, ' ').trim();
  let context: string | undefined;
  if (text && text.length <= 1200) {
    const sentences = text.match(/[^。！？.!?]+[。！？.!?]?/g) ?? [text];
    context = sentences.find(sentence => sentence.includes(term))?.trim() || text.slice(0, 500);
    if (context.length > 500) {
      const index = context.indexOf(term);
      const left = Math.max(0, index - 180);
      context = `${left ? '…' : ''}${context.slice(left, left + 500)}${left + 500 < context.length ? '…' : ''}`;
    }
  }
  return { term, range, context };
}
export function anchorRect(pick: Pick): DOMRect | null {
  if (!pick.range.startContainer.isConnected || !pick.range.endContainer.isConnected) return null;
  const rects = Array.from(pick.range.getClientRects());
  let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
  let ancestor = pick.range.commonAncestorContainer instanceof Element ? pick.range.commonAncestorContainer : pick.range.commonAncestorContainer.parentElement;
  while (ancestor) {
    const style = getComputedStyle(ancestor);
    const bounds = ancestor.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
    ancestor = ancestor.parentElement;
  }
  return rects.reverse().find(r => r.width > 0 && r.height > 0 && r.bottom > top && r.top < bottom && r.right > left && r.left < right) ?? null;
}
