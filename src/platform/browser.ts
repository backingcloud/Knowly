// Chromium compatibility boundary: keep vendor-specific APIs out of React.
export async function copyText(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); return; } catch { /* Older Chromium fallback */ }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.cssText = 'position:fixed;left:-9999px;top:0';
  const active = document.activeElement as HTMLElement | null;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({length: selection.rangeCount}, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  document.body.append(area);
  try {
    area.select();
    if (!document.execCommand('copy')) throw new Error('复制失败，请手动选择卡片内容复制');
  } finally {
    area.remove(); active?.focus({preventScroll: true});
    selection?.removeAllRanges(); ranges.forEach(range => selection?.addRange(range));
  }
}
