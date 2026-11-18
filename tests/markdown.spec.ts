import { test, expect } from '@playwright/test';
import { cardsToMarkdown, nestedMarkdown, type LearningCard } from '../src/services/cards';

test('export nests each question and its knowledge headings without polluting card outline',()=>{
  const card:LearningCard={id:'one',term:'鲁棒性',sourceUrl:'https://example.com',sourceTitle:'测试',createdAt:'2026-11-18',context:'原句',personalNote:'# 我的补充\n笔记',explanation:{definition:'# 定义\n解释',usage:'',example:''},followUps:[{question:'一般表现怎么样？',contextSent:'原句',answer:'# 1. 故障影响面小\n正文\n## 1. 自动恢复\n细节\n### 1. 重试\n内容\n# 2. 运维压力小\n正文'},{question:'还有哪些情况？',answer:'## 总结\n内容'}]};
  const md=cardsToMarkdown([card,{...card,id:'two',term:'另一张卡'}]);
  expect(md).toContain('### 3. 继续追问');expect(md).toContain('#### (1) 一般表现怎么样？');
  expect(md).toContain('##### ① 故障影响面小');expect(md).toContain('###### a. 自动恢复');expect(md).toContain('- **(a) 重试**');
  expect(md).toContain('##### ② 运维压力小');expect(md).toContain('#### (2) 还有哪些情况？');expect(md).toContain('##### ① 总结');
  expect(md).toContain('> 本次追问附带原句：原句');expect(md).toContain('### 4. 我的笔记\n\n#### (1) 我的补充');
  expect(md.match(/^## /gm)).toHaveLength(2);expect(md.match(/^# /gm)).toHaveLength(1);
});

test('heading normalization preserves code, nested lists, and plain text; supports setext',()=>{
  const source='标题\n===\n正文\n\n```md\n# 代码里的标题\n  - 保留缩进\n```\n\n- 要点\n  - 子项\n    - 孙项\n\n## 子标题\n正文';
  const result=nestedMarkdown(source,4);
  expect(result).toContain('#### (1) 标题');expect(result).toContain('##### ① 子标题');
  expect(result).toContain('```md\n# 代码里的标题\n  - 保留缩进\n```');
  expect(result).toContain('- 要点\n  - 子项\n    - 孙项');
  expect(nestedMarkdown('普通回答，没有标题。',5)).toBe('普通回答，没有标题。');
  expect(nestedMarkdown('# C#\n\n## 示例 ##',4)).toBe('#### (1) C#\n\n##### ① 示例');
});
