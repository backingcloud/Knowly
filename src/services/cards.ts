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

function chineseNumber(value: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (value <= 0 || value > 99) return String(value);
  if (value <= 10) return value === 10 ? '十' : digits[value];
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
    '### 1. 选中内容',
    '',
    `> ${oneLine(card.term)}`,
  ];
  if (card.context?.trim()) lines.push('', '**所在句子：**', '', `> ${card.context.trim().replace(/\r?\n/g, '\n> ')}`);
  lines.push('', '### 2. AI 解释', '', card.explanation.definition.trim());
  if (card.explanation.usage.trim()) lines.push('', `**有什么用：** ${card.explanation.usage.trim()}`);
  if (card.explanation.example.trim()) lines.push('', `**举个例子：** ${card.explanation.example.trim()}`);

  let sectionNumber = 3;
  if (card.followUps.length) {
    lines.push('', `### ${sectionNumber}. 继续追问`);
    for (const turn of card.followUps) lines.push('', `**问：** ${turn.question}`, '', `**答：** ${turn.answer}`);
    sectionNumber += 1;
  }
  if (card.personalNote.trim()) lines.push('', `### ${sectionNumber}. 我的笔记`, '', card.personalNote.trim());
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
  const topic = cards.length === 1 ? cards[0].term : `${cards[0]?.term || '学习卡片'}-等${cards.length}张`;
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
