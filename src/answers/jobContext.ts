// The job and the company a page is for, for the {公司} and {职位} of a drafted answer. Only what the page says: a box
// of its own, its site name, or a title that names a job and a company. What it does not say stays unknown.

export interface JobContext {
  company?: string;
  position?: string;
}

const POSITION_BOX = '[data-automation-id="jobTitle"], [data-automation-id="jobPostingHeader"]';
const COMPANY_BOX = '[data-automation-id="company"], [data-automation-id="companyName"]';

const JOB_WORD =
  /工程师|开发|经理|专员|实习生?|设计师|分析师|运营|产品|研究员|顾问|助理|主管|总监|培训生|管培生|engineer|developer|analyst|manager|designer|intern|graduate|specialist|consultant|officer|scientist|associate|architect|administrator|coordinator/i;
const COMPANY_WORD = /公司|集团|科技|有限|银行|证券|研究院|大学|医院|\b(?:group|inc|ltd|pty|limited|corporation|company|bank|holdings|university)\b/i;
/** What a careers site adds after its name. */
const SITE_SUFFIX = /\s*(?:校园招聘|社会招聘|实习生招聘|招聘官网|招聘|官网|加入我们|职位详情|careers?|jobs?|job application)\s*$/i;
/** Separators of a title: a spaced dash, a bar, a middle dot, or a dash between Chinese words. */
const TITLE_PARTS = /\s+[-–—]\s+|[|｜·_]|(?<=\p{Script=Han})[-–—](?=\p{Script=Han})/u;

const textOf = (doc: Document, selector: string): string =>
  (doc.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();

const meta = (doc: Document, property: string): string =>
  (doc.querySelector(`meta[property="${property}"]`)?.getAttribute('content') ?? '').trim();

function clean(part: string): string {
  let out = part.trim();
  for (let before = ''; before !== out; ) {
    before = out;
    out = out.replace(SITE_SUFFIX, '').trim();
  }
  return out;
}

export function jobContextOf(doc: Document): JobContext {
  const parts = [doc.title, meta(doc, 'og:title')].flatMap((t) => t.split(TITLE_PARTS)).map(clean).filter(Boolean);
  const company = textOf(doc, COMPANY_BOX) || meta(doc, 'og:site_name') || parts.find((p) => COMPANY_WORD.test(p)) || '';
  const position = textOf(doc, POSITION_BOX) || parts.find((p) => JOB_WORD.test(p) && !COMPANY_WORD.test(p) && p !== company) || '';
  return { ...(position ? { position } : {}), ...(company ? { company: clean(company) } : {}) };
}
