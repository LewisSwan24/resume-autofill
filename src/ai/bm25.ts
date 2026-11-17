// Layer 1: Pure offline BM25 + character bigram/word hybrid retriever over resume Q&A & experience entries.
import { FIELD_SYNONYMS } from '../dictionary';
import { normalizeLabel } from '../dictionary/normalize';
import type { FieldKey } from '../engine/types';
import type { Resume } from '../schema';
import { resumeFullName } from '../templates';

export interface CorpusDoc {
  id: string;
  queryText: string;
  answerText: string;
  sourceLabel: string;
  sourceKind: 'customAnswer' | 'experience' | 'profile';
  boost: number;
}

export interface Bm25Match {
  text: string;
  score: number;
  sourceLabel: string;
  sourceKind: CorpusDoc['sourceKind'];
}

export interface FieldKeyMatch {
  fieldKey: FieldKey;
  score: number;
  label: string;
}

/** Tokenize mixed English words and CJK unigrams/bigrams without external NLP libs. */
export function tokenize(text: string): string[] {
  const norm = normalizeLabel(text);
  if (!norm) return [];
  const tokens: string[] = [];
  for (const part of norm.split(/\s+/)) {
    if (!part) continue;
    const asciiWords = part.match(/[a-z0-9]+/g);
    if (asciiWords) {
      for (const w of asciiWords) {
        if (w.length >= 2) tokens.push(w);
      }
    }
    const cjkChars = part.match(/\p{Script=Han}/gu);
    if (cjkChars) {
      for (let i = 0; i < cjkChars.length; i++) {
        tokens.push(cjkChars[i]!);
        if (i + 1 < cjkChars.length) tokens.push(`${cjkChars[i]}${cjkChars[i + 1]}`);
      }
    }
  }
  return tokens;
}

/** Extract searchable answerable documents from the user's resume without inventing facts. */
export function buildResumeCorpus(resume: Resume): CorpusDoc[] {
  const docs: CorpusDoc[] = [];

  resume.customAnswers.forEach((qa, idx) => {
    const q = qa.question.trim();
    const a = qa.answer.trim();
    if (q && a) {
      docs.push({
        id: `qa:${idx}`,
        queryText: q,
        answerText: a,
        sourceLabel: q,
        sourceKind: 'customAnswer',
        boost: 1.4,
      });
    }
  });

  if (resume.selfIntroduction.trim()) {
    docs.push({
      id: 'intro',
      queryText: '自我介绍 个人简介 自我评价 优势 特点 about yourself introduce yourself summary bio motivation',
      answerText: resume.selfIntroduction.trim(),
      sourceLabel: resume.locale === 'zh-CN' ? '自我介绍' : 'Profile Summary',
      sourceKind: 'profile',
      boost: 1.0,
    });
  }

  if (resume.hobbies.trim()) {
    docs.push({
      id: 'hobbies',
      queryText: '兴趣爱好 特长 课余 业余 hobbies interests activities',
      answerText: resume.hobbies.trim(),
      sourceLabel: resume.locale === 'zh-CN' ? '兴趣爱好' : 'Hobbies',
      sourceKind: 'profile',
      boost: 1.0,
    });
  }

  resume.work.forEach((w, idx) => {
    const desc = w.description.trim();
    if (desc) {
      docs.push({
        id: `work:${idx}`,
        queryText: `${w.company} ${w.position} 工作内容 实习 职责 成就 收获 experience achievement responsibility`,
        answerText: [w.company, w.position, desc].filter(Boolean).join(' · '),
        sourceLabel: w.company || w.position || `Work ${idx + 1}`,
        sourceKind: 'experience',
        boost: 0.9,
      });
    }
  });

  resume.projects.forEach((p, idx) => {
    const desc = p.description.trim();
    if (desc) {
      docs.push({
        id: `proj:${idx}`,
        queryText: `${p.name} ${p.role} 最有成就感 难点 挑战 项目 经历 project challenge achievement impact`,
        answerText: [p.name, p.role, desc].filter(Boolean).join(' · '),
        sourceLabel: p.name || `Project ${idx + 1}`,
        sourceKind: 'experience',
        boost: 0.95,
      });
    }
  });

  if (resume.skills.length > 0) {
    docs.push({
      id: 'skills',
      queryText: '掌握技能 熟悉 技术栈 专业能力 skills technical tools proficiency',
      answerText: resume.skills.map((s) => (s.level ? `${s.name} (${s.level})` : s.name)).join(', '),
      sourceLabel: resume.locale === 'zh-CN' ? '专业技能' : 'Skills',
      sourceKind: 'profile',
      boost: 0.9,
    });
  }

  const name = resumeFullName(resume);
  if (name && resume.jobIntention.positions.length > 0) {
    docs.push({
      id: 'intention',
      queryText: '求职意向 为什么申请 意向岗位 目标职位 期待薪资 why apply position motivation role',
      answerText: resume.jobIntention.positions.join(', '),
      sourceLabel: resume.locale === 'zh-CN' ? '求职意向' : 'Target Position',
      sourceKind: 'profile',
      boost: 0.85,
    });
  }

  return docs;
}

const K1 = 1.5;
const B = 0.75;

/** Rank resume corpus documents using Okapi BM25. Returns top matches above minimum score. */
export function retrieveBm25Matches(question: string, resume: Resume, limit = 3): Bm25Match[] {
  const qTokens = tokenize(question);
  if (qTokens.length === 0) return [];
  const docs = buildResumeCorpus(resume);
  if (docs.length === 0) return [];

  const tokenizedDocs = docs.map((d) => tokenize(`${d.queryText} ${d.answerText.slice(0, 120)}`));
  const avgDl = tokenizedDocs.reduce((sum, t) => sum + t.length, 0) / tokenizedDocs.length || 1;

  const df = new Map<string, number>();
  for (const tokens of tokenizedDocs) {
    for (const uniq of new Set(tokens)) {
      df.set(uniq, (df.get(uniq) ?? 0) + 1);
    }
  }

  const N = docs.length;
  const scored: Bm25Match[] = [];

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]!;
    const tokens = tokenizedDocs[i]!;
    if (tokens.length === 0) continue;

    const tf = new Map<string, number>();
    for (const tok of tokens) tf.set(tok, (tf.get(tok) ?? 0) + 1);

    let score = 0;
    for (const qt of qTokens) {
      const f = tf.get(qt) ?? 0;
      if (f === 0) continue;
      const nqi = df.get(qt) ?? 0;
      const idf = Math.log(1 + (N - nqi + 0.5) / (nqi + 0.5));
      const normTf = (f * (K1 + 1)) / (f + K1 * (1 - B + (B * tokens.length) / avgDl));
      score += idf * normTf;
    }

    if (score > 0) {
      scored.push({
        text: doc.answerText,
        score: Math.round(score * doc.boost * 1000) / 1000,
        sourceLabel: doc.sourceLabel,
        sourceKind: doc.sourceKind,
      });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .filter((m, i) => i === 0 || m.score >= scored[0]!.score * 0.4)
    .slice(0, limit);
}

/** Suggest likely schema FieldKeys for an unrecognized label using BM25 over dictionary synonyms. */
export function retrieveSynonymFieldCandidates(
  label: string,
  locale: Resume['locale'],
  limit = 3,
): FieldKeyMatch[] {
  const qTokens = tokenize(label);
  if (qTokens.length === 0) return [];
  const entries = Object.entries(FIELD_SYNONYMS) as Array<[FieldKey, { zh: readonly string[]; en: readonly string[] }]>;
  const qSet = new Set(qTokens);

  const hits: FieldKeyMatch[] = [];
  for (const [key, syn] of entries) {
    const terms = [...syn.zh, ...syn.en];
    let bestOverlap = 0;
    for (const term of terms) {
      const dt = tokenize(term);
      if (dt.length === 0) continue;
      let shared = 0;
      for (const tok of dt) {
        if (qSet.has(tok)) shared++;
      }
      const jaccard = shared / (dt.length + qSet.size - shared);
      if (jaccard > bestOverlap) bestOverlap = jaccard;
    }
    if (bestOverlap >= 0.25) {
      const display = (locale === 'zh-CN' ? syn.zh[0] : syn.en[0]) ?? key;
      hits.push({ fieldKey: key, score: Math.round(bestOverlap * 1000) / 1000, label: display });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
