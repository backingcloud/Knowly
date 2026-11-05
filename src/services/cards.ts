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

function cleanAiMarkdown(value: string): string {
  let inCodeFence = false;
  const lines = value.split(/\r?\n/).map(line => {
    if (/^\s*(?:`{3,}|~{3,})/.test(line)) {
      inCodeFence = !inCodeFence;
      return line.trimEnd();
    }
    if (inCodeFence) return line.trimEnd();
    return line
      .replace(/(\*\*(?:����ʲô|��ʲô|��ʲô��|��;|�ٸ�����|����|�ܽ�|ע������|��������)[��:]?\*\*)[\s\u200B\u2060]*(?:��|?(?:?|?)?|?|?(?:?|?)?|??|?|?)+/giu, '$1')
      .replace(/[\s\u200B\u2060]*(?:��|?(?:?|?)?|?|?(?:?|?)?|??|?|?|&darr;|&#(?:8595|x2193);)+(?=[*_`~]*[\s\u200B\u2060]*$)/giu, '')
      .replace(/[\t \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]{2,}/gu, ' ')
      .trimEnd();
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function chineseNumber(value: number): string {
  const digits = ['��', 'һ', '��', '��', '��', '��', '��', '��', '��', '��'];
  if (value <= 0 || value > 99) return String(value);
  if (value <= 10) return value === 10 ? 'ʮ' : digits[value];
  if (value < 20) return `ʮ${digits[value % 10]}`;
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${digits[tens]}ʮ${ones ? digits[ones] : ''}`;
}

export function cardToMarkdown(card: LearningCard, index: number): string {
  const provider: ProviderId = card.explanation.provider ?? 'deepseek';
  const providerLabel: Record<ProviderId, string> = { deepseek: 'DeepSeek', zhipu: '���� GLM', doubao: '����' };
  const lines = [
    `## ${chineseNumber(index)}��${oneLine(card.term)}`,
    '',
    `> ��Դ��[${oneLine(card.sourceTitle || card.sourceUrl)}](${card.sourceUrl})������ģ�ͣ�${providerLabel[provider]}����������ʱ�䣺${card.createdAt}`,
    '',
    '### 1. ѡ������',
    '',
    `> ${oneLine(card.term)}`,
  ];
  if (card.context?.trim()) lines.push('', '**���ھ��ӣ�**', '', `> ${card.context.trim().replace(/\r?\n/g, '\n> ')}`);
  lines.push('', '### 2. AI ����', '', cleanAiMarkdown(card.explanation.definition));
  const usage = cleanAiMarkdown(card.explanation.usage);
  const example = cleanAiMarkdown(card.explanation.example);
  if (usage) lines.push('', `**��ʲô�ã�** ${usage}`);
  if (example) lines.push('', `**�ٸ����ӣ�** ${example}`);

  let sectionNumber = 3;
  if (card.followUps.length) {
    lines.push('', `### ${sectionNumber}. ����׷��`);
    for (const turn of card.followUps) lines.push('', `**�ʣ�** ${turn.question}`, '', `**��** ${cleanAiMarkdown(turn.answer)}`);
    sectionNumber += 1;
  }
  if (card.personalNote.trim()) lines.push('', `### ${sectionNumber}. �ҵıʼ�`, '', card.personalNote.trim());
  return lines.join('\n');
}

export function cardsToMarkdown(cards: LearningCard[]): string {
  const day = new Date().toLocaleDateString('sv-SE');
  return `# Knowly ѧϰ��Ƭ �� ${day} �� �� ${cards.length} ��\n\n${cards.map((card, index) => cardToMarkdown(card, index + 1)).join('\n\n---\n\n')}\n`;
}

export function markdownFilename(cards: LearningCard[]): string {
  const now = new Date();
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
  const topic = cards.length === 1 ? cards[0].term : `${cards[0]?.term || 'ѧϰ��Ƭ'}-��${cards.length}��`;
  const safe = topic.replace(/[\\/:*?"<>|\r\n]+/g, '-').replace(/\s+/g, '-').trim().slice(0, 40) || 'ѧϰ��Ƭ';
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

