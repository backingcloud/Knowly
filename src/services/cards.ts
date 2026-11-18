import type { Explanation, FollowUp, ProviderId } from './explanation';

export interface LearningCard {
  id: string;
  term: string;
  explanation: Explanation;
  context?: string;
  sourceTitle: string;
  sourceUrl: string;
  createdAt: string;
  personalNote: string;
  followUps: FollowUp[];
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function boldSelectedTerm(sentence: string, term: string): string {
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escapedTerm ? sentence.replace(new RegExp(escapedTerm, 'giu'), match => `**${match}**`) : sentence;
}

function cleanAiMarkdown(value: string): string {
  let inCodeFence = false;
  const lines = value.split(/\r?\n/).map(line => {
    if (/^\s*(?:`{3,}|~{3,})/.test(line)) {
      inCodeFence = !inCodeFence;
      return line.trimEnd();
    }
    if (inCodeFence) return line.trimEnd();
    const indent = line.match(/^[\t ]*/)?.[0] ?? '';
    return indent + line.slice(indent.length)
      .replace(/(\*\*(?:这是什么|是什么|有什么用|用途|举个例子|例子|总结|注意事项|工作流程)[：:]?\*\*)[\s\u200B\u2060]*(?:↓|⬇(?:️|︎)?|⇩|⤵(?:️|︎)?|👇|↡|⇓)+/giu, '$1')
      .replace(/[\s\u200B\u2060]*(?:↓|⬇(?:️|︎)?|⇩|⤵(?:️|︎)?|👇|↡|⇓|&darr;|&#(?:8595|x2193);)+(?=[*_`~]*[\s\u200B\u2060]*$)/giu, '')
      .replace(/[\t \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]{2,}/gu, ' ')
      .trimEnd();
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Nest model headings beneath the owning section; never let them become card siblings. */
export function nestedMarkdown(value: string, baseLevel: number): string {
  const lines = cleanAiMarkdown(value).split('\n');
  let fence = '', fenceLength = 0;
  const stack: number[] = [], counters: number[] = [];
  return lines.map((line, index) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      const token = marker[1]!;
      if (!fence) { fence = token[0]!; fenceLength = token.length; }
      else if (token[0] === fence && token.length >= fenceLength && /^ {0,3}(?:`+|~+)\s*$/.test(line)) fence = '';
      return line;
    }
    if (fence || /^(?: {4}|\t)/.test(line)) return line;
    let heading = line.match(/^ {0,3}(#{1,6})[\t ]+(.+?)\s*$/);
    // Setext headings (title followed by === or ---), outside fenced code.
    if (!heading && line.trim() && /^ {0,3}(?:=+|-+)\s*$/.test(lines[index + 1] ?? '')) {
      heading = ['', (lines[index + 1]!.trim()[0] === '=' ? '#' : '##'), line.trim()];
      lines[index + 1] = '';
    }
    if (!heading) return line;
    const sourceLevel = heading[1]!.length;
    while (stack.length && stack[stack.length - 1]! > sourceLevel) stack.pop();
    if (!stack.length || stack[stack.length - 1] !== sourceLevel) stack.push(sourceLevel);
    const depth = stack.length - 1;
    counters[depth] = (counters[depth] ?? 0) + 1; counters.length = depth + 1;
    const number = counters[depth]!;
    const totalDepth = baseLevel - 4 + depth;
    const letter = (n: number): string => n > 26 ? letter(Math.floor((n - 1) / 26)) + String.fromCharCode(97 + (n - 1) % 26) : String.fromCharCode(96 + n);
    const prefix = totalDepth === 0 ? `(${number})` : totalDepth === 1 ? (number <= 20 ? String.fromCodePoint(0x245f + number) : `(${number})`) : totalDepth === 2 ? `${letter(number)}.` : `(${letter(number)})`;
    const title = heading[2]!.replace(/[\t ]+#+\s*$/, '').replace(/^(?:\d+[.、)]|[（(]\d+[）)]|[①-⑳]|[a-z][.)])\s*/, '');
    const level = baseLevel + depth;
    return level <= 6 ? `${'#'.repeat(level)} ${prefix} ${title}` : `${'  '.repeat(level - 7)}- **${prefix} ${title}**`;
  }).join('\n');
}

function chineseNumber(value: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (value <= 0 || value > 99) return String(value);
  if (value <= 10) return value === 10 ? '十' : digits[value]!;
  if (value < 20) return `十${digits[value % 10]}`;
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${digits[tens]}十${ones ? digits[ones] : ''}`;
}

export function cardToMarkdown(card: LearningCard, index: number): string {
  const provider: ProviderId = card.explanation.provider ?? 'deepseek';
  const providerLabel: Record<ProviderId, string> = { deepseek: 'DeepSeek', zhipu: '智谱 GLM', doubao: '豆包' };
  const lines = [
    `## ${chineseNumber(index)}、${oneLine(card.term)}`,
    '',
    `> 来源：[${oneLine(card.sourceTitle || card.sourceUrl)}](${card.sourceUrl})　·　模型：${providerLabel[provider]}　·　保存时间：${card.createdAt}`,
    '',
    '### 1. 原句',
    '',
    card.context?.trim()
      ? `> ${boldSelectedTerm(card.context.trim().replace(/\r?\n/g, ' '), card.term)}`
      : `> ${oneLine(card.term)}`,
  ];
  lines.push('', '### 2. AI 解释', '', nestedMarkdown(card.explanation.definition, 4));
  const usage = nestedMarkdown(card.explanation.usage, 4);
  const example = nestedMarkdown(card.explanation.example, 4);
  if (usage) lines.push('', `**有什么用：** ${usage}`);
  if (example) lines.push('', `**举个例子：** ${example}`);

  let sectionNumber = 3;
  if (card.followUps.length) {
    lines.push('', `### ${sectionNumber}. 继续追问`);
    card.followUps.forEach((turn, turnIndex) => {
      const title = oneLine(turn.question).replace(/[#*_`\[\]<>]/g, '').slice(0, 70);
      lines.push('', `#### (${turnIndex + 1}) ${title}${oneLine(turn.question).length > 70 ? '…' : ''}`, '', `**问：** ${turn.question}`, '', '**答：**', '', nestedMarkdown(turn.answer, 5));
      if (turn.contextSent) lines.push('', `> 本次追问附带原句：${oneLine(turn.contextSent)}`);
    });
    sectionNumber += 1;
  }
  if (card.personalNote.trim()) lines.push('', `### ${sectionNumber}. 我的笔记`, '', nestedMarkdown(card.personalNote.trim(), 4));
  return lines.join('\n');
}

export function cardsToMarkdown(cards: LearningCard[]): string {
  const day = new Date().toLocaleDateString('sv-SE');
  return `# Knowly 学习卡片 · ${day} · 共 ${cards.length} 张\n\n${cards.map((card, index) => cardToMarkdown(card, index + 1)).join('\n\n---\n\n')}\n`;
}

export function markdownFilename(cards: LearningCard[]): string {
  const now = new Date();
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
  const topic = cards.length === 1 ? cards[0]!.term : `${cards[0]?.term || '学习卡片'}-等${cards.length}张`;
  const safe = topic.replace(/[\\/:*?"<>|\r\n]+/g, '-').replace(/\s+/g, '-').trim().slice(0, 40) || '学习卡片';
  return `Knowly-${safe}-${timestamp}.md`;
}

export function downloadMarkdown(cards: LearningCard[]): void {
  const content = cardsToMarkdown(cards);
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = markdownFilename(cards);
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
