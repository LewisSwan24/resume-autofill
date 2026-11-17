// Pure offline Job Description (JD) keyword extractor, match scorer, and non-destructive VariantMeta recommender.
import { tokenize } from '../ai/bm25';
import type { Resume, VariantMeta } from '../schema';

export interface ExperienceRelevance {
  section: 'work' | 'projects';
  index: number;
  title: string;
  score: number;
  matchedTerms: string[];
}

export interface JdAnalysisResult {
  targetRole: string;
  matchScore: number;
  totalKeywords: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  experienceRelevance: ExperienceRelevance[];
}

const STOPWORDS = new Set([
  'with', 'that', 'this', 'from', 'have', 'will', 'your', 'about', 'into', 'more', 'other', 'such', 'what',
  'work', 'team', 'experience', 'years', 'year', 'role', 'skills', 'ability', 'good', 'strong', 'using',
  'related', 'plus', 'preferred', 'required', 'must', 'looking', 'seeking', 'candidate', 'including',
  '工作', '经验', '负责', '参与', '具备', '熟悉', '掌握', '良好', '优先', '要求', '职责', '能力', '学历', '以上', '相关', '团队',
]);

const TECH_PHRASE_RE = /[A-Za-z][A-Za-z0-9+#.-]{1,24}/g;
const CJK_TERM_RE = /[\u4e00-\u9fff]{2,6}/g;

/** Extract salient technical/domain keywords (max 25) ranked by JD frequency and requirement cues. */
export function extractJdKeywords(jdText: string, maxKeywords = 25): string[] {
  const weights = new Map<string, { display: string; weight: number }>();

  const bump = (raw: string, boost: number) => {
    const clean = raw.replace(/^[.,;:()\[\]]+|[.,;:()\[\]]+$/g, '');
    const lower = clean.toLowerCase();
    if (clean.length < 2 || STOPWORDS.has(lower)) return;
    const prev = weights.get(lower);
    if (prev) prev.weight += boost;
    else weights.set(lower, { display: clean, weight: boost });
  };

  for (const line of jdText.split(/\r?\n/)) {
    const lineBoost = /(?:required|must|精通|熟悉|核心|必备)/i.test(line) ? 2 : 1;
    for (const m of line.match(TECH_PHRASE_RE) ?? []) {
      bump(m, lineBoost);
    }
    for (const m of line.match(CJK_TERM_RE) ?? []) {
      if (!STOPWORDS.has(m)) bump(m, lineBoost * 0.8);
    }
  }

  return Array.from(weights.values())
    .sort((a, b) => b.weight - a.weight || b.display.length - a.display.length)
    .slice(0, maxKeywords)
    .map((x) => x.display);
}

function resumeSearchText(resume: Resume): string {
  const parts: string[] = [
    resume.selfIntroduction,
    resume.hobbies,
    ...resume.jobIntention.positions,
    ...resume.skills.map((s) => `${s.name} ${s.level}`),
    ...resume.work.map((w) => `${w.company} ${w.position} ${w.description}`),
    ...resume.projects.map((p) => `${p.name} ${p.role} ${p.description}`),
    ...resume.education.map((e) => `${e.major} ${e.courses} ${e.thesis}`),
    ...resume.certificates.map((c) => c.name),
    ...resume.customAnswers.map((a) => `${a.question} ${a.answer}`),
  ];
  return parts.join('\n');
}

function containsTerm(haystackLower: string, haystackTokens: ReadonlySet<string>, term: string): boolean {
  const lower = term.toLowerCase();
  if (haystackLower.includes(lower)) return true;
  const termTokens = tokenize(term);
  return termTokens.length > 0 && termTokens.every((t) => haystackTokens.has(t));
}

export function inferTargetRoleFromJd(jdText: string): string {
  const firstNonEmpty = jdText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 1 && l.length <= 80);
  if (!firstNonEmpty) return '';
  return firstNonEmpty.replace(/^(?:职位|岗位|title|role|position)[:：\s]+/i, '').slice(0, 80);
}

/** Run pure offline JD keyword coverage analysis and rank experiences without external requests. */
export function analyzeResumeAgainstJd(resume: Resume, jdText: string): JdAnalysisResult {
  const keywords = extractJdKeywords(jdText, 24);
  const fullText = resumeSearchText(resume);
  const fullLower = fullText.toLowerCase();
  const fullTokens = new Set(tokenize(fullText));

  const matchedKeywords: string[] = [];
  const missingKeywords: string[] = [];
  for (const kw of keywords) {
    if (containsTerm(fullLower, fullTokens, kw)) matchedKeywords.push(kw);
    else missingKeywords.push(kw);
  }

  const matchScore = keywords.length === 0 ? 0 : Math.round((matchedKeywords.length / keywords.length) * 100);

  const scoreItem = (title: string, body: string): { score: number; matchedTerms: string[] } => {
    if (keywords.length === 0) return { score: 0, matchedTerms: [] };
    const lower = `${title}\n${body}`.toLowerCase();
    const tokens = new Set(tokenize(lower));
    const hits = keywords.filter((kw) => containsTerm(lower, tokens, kw));
    return {
      score: Number((hits.length / Math.min(keywords.length, 8)).toFixed(3)),
      matchedTerms: hits,
    };
  };

  const experienceRelevance: ExperienceRelevance[] = [
    ...resume.work.map((w, index) => {
      const res = scoreItem(`${w.company} ${w.position}`, w.description);
      return { section: 'work' as const, index, title: `${w.company} · ${w.position}`.trim(), ...res };
    }),
    ...resume.projects.map((p, index) => {
      const res = scoreItem(`${p.name} ${p.role}`, p.description);
      return { section: 'projects' as const, index, title: `${p.name} · ${p.role}`.trim(), ...res };
    }),
  ].sort((a, b) => b.score - a.score);

  return {
    targetRole: inferTargetRoleFromJd(jdText),
    matchScore,
    totalKeywords: keywords.length,
    matchedKeywords,
    missingKeywords,
    experienceRelevance,
  };
}

/** Build a non-destructive VariantMeta preset promoting covered JD skills and hiding zero-relevance overflow items. */
export function buildVariantMetaFromJd(resume: Resume, analysis: JdAnalysisResult): VariantMeta {
  const lowerMatched = new Set(analysis.matchedKeywords.map((k) => k.toLowerCase()));
  const highlightedSkills = resume.skills
    .map((s) => s.name)
    .filter((name) => {
      const low = name.toLowerCase();
      return Array.from(lowerMatched).some((k) => low.includes(k) || k.includes(low));
    });

  // Only suggest hiding excess items if there are > 2 items and at least one scores 0 while others match.
  const hiddenWork =
    resume.work.length > 2 && analysis.experienceRelevance.some((e) => e.section === 'work' && e.score > 0)
      ? analysis.experienceRelevance.filter((e) => e.section === 'work' && e.score === 0).map((e) => e.index)
      : [];
  const hiddenProjects =
    resume.projects.length > 2 && analysis.experienceRelevance.some((e) => e.section === 'projects' && e.score > 0)
      ? analysis.experienceRelevance.filter((e) => e.section === 'projects' && e.score === 0).map((e) => e.index)
      : [];

  return {
    ...(analysis.targetRole ? { targetRole: analysis.targetRole } : {}),
    highlightedSkills: highlightedSkills.slice(0, 20),
    jdKeywords: [...analysis.matchedKeywords, ...analysis.missingKeywords].slice(0, 30),
    ...((hiddenWork.length > 0 || hiddenProjects.length > 0)
      ? {
          hiddenIndices: {
            ...(hiddenWork.length > 0 ? { work: hiddenWork } : {}),
            ...(hiddenProjects.length > 0 ? { projects: hiddenProjects } : {}),
          },
        }
      : {}),
  };
}
