// What a recording needs from the applicant before it starts, the same for the command line and the recorder page,
// and why a finished one may hold no form. The second never stops a sample being written: a
// recording of a captcha is no leak, only no use, and the applicant is the one to judge it.

export const CHECKLIST: { id: string; text: string }[] = [
  { id: 'fictional', text: '已存简历都是虚构的；你的真实姓名、地址等已写进要遮盖的词（scrub-terms.txt 或「另外要遮盖的词」）。' },
  { id: 'country', text: '国码：中国站点勾上「中国站点」（命令行用 --cn），+86 手机号和身份证号才会被遮盖。' },
  { id: 'consent', text: '隐私和同意勾选框由你自己决定，录制不会替你勾，也不会提交。' },
  { id: 'not-applied', text: '这个职位还没投过：投过的职位不会再显示表单。' },
  { id: 'signed-in', text: '登录、验证码、滑块都已由你完成，页面停在表单上。' },
];

/** A Chinese portal, by its address (.cn) or the language the page declares. */
export function looksChinese(url: string, lang: string): boolean {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return /\.cn$/i.test(host) || /^zh\b/i.test(lang.trim());
}

export type PageWarning = 'no-form' | 'captcha' | 'applied';

// A box an applicant could fill: what discover() looks at, roughly. A hidden input or a button is none.
const BOX = /<(?:select|textarea)\b|<input\b(?![^>]*\btype=["']?(?:hidden|submit|button|image|reset)\b)|\brole=["'](?:combobox|textbox|listbox|radiogroup|spinbutton)["']/i;
// By class or frame address: the widgets themselves. A field merely named after a captcha does not count.
const CAPTCHA_MARKUP = /\bclass=["'][^"']*\b(?:geetest_|g-recaptcha|h-captcha|nc_wrapper|nc-container|tcaptcha)|\bsrc=["'][^"']*(?:recaptcha\/api|hcaptcha\.com|captcha\.(?:qq|aliyun)|geetest\.com)/i;
const CAPTCHA_TEXT = /请完成(?:安全)?验证|拖动滑块|滑动验证|向右滑动|安全验证|verify you are (?:a )?human|i'?m not a robot|complete the security check/i;
// The page's own sentence that this job was applied for, never a menu of past applications.
const APPLIED_TEXT = /(?:您|你)已(?:经)?(?:投递|申请)过|已投递过该职位|you(?:'ve| have) already applied|already (?:applied|submitted an application) (?:for|to) this/i;

const visibleText = (html: string): string =>
  html
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/\s+/g, ' ');

/**
 * Why the recorded frames hold no application form, by the pages as written into the sample. Nothing while any frame
 * has a box to fill: a form often carries a reCAPTCHA at its foot, and a page may keep a hidden note for a second visit.
 */
export function pageWarnings(pages: { file: string; html: string }[]): PageWarning[] {
  if (pages.some((p) => BOX.test(p.html))) return [];
  const out: PageWarning[] = ['no-form'];
  if (pages.some((p) => CAPTCHA_MARKUP.test(p.html) || CAPTCHA_TEXT.test(visibleText(p.html)))) out.push('captcha');
  if (pages.some((p) => APPLIED_TEXT.test(visibleText(p.html)))) out.push('applied');
  return out;
}

export const WARNING_TEXT: Record<PageWarning, string> = {
  'no-form': '没录到表单：每个 frame 里都没有可填的框。',
  captcha: '录到的可能是验证码或滑块页，不是表单。',
  applied: '页面说这个职位已经投过，录到的可能不是表单。',
};
