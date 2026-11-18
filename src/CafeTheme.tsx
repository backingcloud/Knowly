import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { browser } from 'wxt/browser';

export const THEME_KEY = 'knowlyCafePalette';
export const palettes = {
  cafe: ['咖啡原色', '#fffdf5', '#fff9e9', '#fffdf7', '#f2e5cb', '#e3d3b4', '#76502f'],
  white: ['珍珠白', '#ffffff', '#ffffff', '#ffffff', '#f0f1ee', '#d4d8d3', '#44534c'],
  blue: ['晴空蓝', '#f0f5fc', '#e5eef9', '#fbfdff', '#dce8f6', '#bacce2', '#325775'],
  yellow: ['奶油黄', '#fffaf0', '#fbf0d5', '#fffdf7', '#f6eac8', '#d7c79a', '#685329'],
  red: ['珊瑚红', '#fdf4f3', '#f8e7e4', '#fffbfa', '#f2dcd8', '#dcbab3', '#81504b'],
  green: ['鼠尾草绿', '#f3f8f3', '#e8f0e6', '#fcfefb', '#dfeadd', '#bfd0b8', '#395d48'],
  purple: ['雾紫', '#f7f4fc', '#ede7f6', '#fdfbff', '#e7dff1', '#cbbdde', '#65517e'],
};
export type Palette = keyof typeof palettes;
export function paletteStyle(palette: Palette): CSSProperties {
  return Object.fromEntries(['--base', '--panel', '--input', '--soft', '--line', '--accent'].map((key, i) => [key, palettes[palette][i + 1]]));
}
export function usePalette() {
  const [palette, setPalette] = useState<Palette>('cafe');
  useEffect(() => { void browser.storage.local.get(THEME_KEY).then(value => { if (Object.hasOwn(palettes, value[THEME_KEY] as string)) setPalette(value[THEME_KEY] as Palette); }); }, []);
  return [palette, (next: Palette) => { setPalette(next); void browser.storage.local.set({ [THEME_KEY]: next }); }] as const;
}
export function Appearance({ palette, onChange }: { palette: Palette; onChange: (next: Palette) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (root.current && !event.composedPath().includes(root.current)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopImmediatePropagation(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape, true);
    root.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  return <div className="appearance" ref={root}>
    <button type="button" ref={trigger} className="appearance-trigger" title="更换弹窗配色" aria-label="更换弹窗配色" aria-expanded={open} onClick={() => setOpen(value => !value)}><span /></button>
    {open && <div className="appearance-panel" role="group" aria-label="弹窗配色"><strong>弹窗配色</strong><small>文字随底色自动适配</small><div className="swatches">{(Object.keys(palettes) as Palette[]).map(key => <button type="button" key={key} aria-pressed={palette === key} onClick={() => onChange(key)}><i style={{ background: palettes[key][4] }} />{palettes[key][0]}</button>)}</div></div>}
  </div>;
}
export function ActionIcon({ name }: { name: 'copy' | 'download' | 'save' | 'update' | 'next' }) {
  const paths = { copy: 'M8 8h12v12H8zM16 8V4H4v12h4', download: 'M14 3H5v18h14V8zM14 3v5h5M12 10v7m-3-3 3 3 3-3', save: 'M7 3h10v18l-5-3-5 3zM9 9h6m-3-3v6', update: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2', next: 'm4 3 2 15 4-5 6-2zM14 18h7m-3-3 3 3-3 3' };
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>;
}
