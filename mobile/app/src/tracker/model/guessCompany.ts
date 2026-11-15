// A company name guessed from the page title, else from the host. Pure; the person can always edit it.
import { cleanTitle } from '../../browser/model/recentTitle';

const MAX = 80;

const SEPARATORS = / - | – | — |\||_|·|：|:/;

const SUFFIXES = [
  /\d{4}(届|年)?$/,
  /校园招聘$/,
  /校招$/,
  /社会招聘$/,
  /社招$/,
  /实习生招聘$/,
  /招聘官网$/,
  /招聘$/,
  /官网$/,
  /网申$/,
  /正式启动$/,
  /加入我们$/,
  /careers$/i,
  /career$/i,
  /jobs$/i,
  /recruitment$/i,
  /join us$/i,
];

const ORG_WORDS = /公司|集团|银行|科技|证券|保险|研究院|大学|医院|inc|corp|ltd|group|bank/i;
const POSITION_WORDS = /产品经理|工程师|设计师|管培生|实习生|intern|engineer|manager/i;

const ATS_HOSTS = [
  'mokahr.com',
  'zhiye.com',
  'hotjob.cn',
  'feishu.cn',
  'jobs.feishu.cn',
  'myworkdayjobs.com',
  'greenhouse.io',
  'lever.co',
  'smartrecruiters.com',
  'zhaopin.com',
  '51job.com',
  'liepin.com',
];

const HOST_PREFIXES = /^(www|jobs|careers|campus|hr|job|zhaopin)\./;
// Longest first, so .com.cn goes before .cn.
const PUBLIC_SUFFIXES = [
  '.com.cn',
  '.net.cn',
  '.org.cn',
  '.edu.cn',
  '.gov.cn',
  '.co.uk',
  '.com.hk',
  '.com',
  '.cn',
  '.net',
  '.org',
  '.io',
  '.co',
  '.hk',
  '.tw',
  '.jp',
  '.uk',
  '.de',
  '.ai',
  '.app',
  '.dev',
  '.top',
  '.xyz',
];

function cut(s: string): string {
  if (s.length <= MAX) return s;
  let t = s.slice(0, MAX);
  const last = t.charCodeAt(t.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) t = t.slice(0, -1);
  return t.trimEnd();
}

function stripSuffixes(segment: string): string {
  let s = segment;
  for (;;) {
    const before = s;
    for (const suffix of SUFFIXES) s = s.replace(suffix, '').trim();
    if (s === before) return s;
  }
}

function fromTitle(title: string): string {
  const segments = cleanTitle(title)
    .split(SEPARATORS)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  const stripped = segments.map((s) => ({ before: s, after: stripSuffixes(s) })).filter((s) => s.after !== '');
  const org = stripped.find((s) => ORG_WORDS.test(s.after));
  if (org) return org.after;
  const changed = stripped.find((s) => s.after !== s.before);
  if (changed) return changed.after;
  const plain = stripped
    .map((s) => s.after)
    .filter((s) => [...s].length >= 2 && [...s].length <= 30 && !POSITION_WORDS.test(s))
    .sort((a, b) => [...a].length - [...b].length);
  return plain[0] ?? '';
}

function fromHost(rawHost: string): string {
  let host = rawHost
    .toLowerCase()
    .replace(/^\[([^\]]*)\](?::\d+)?$/, '$1')
    .replace(/^([^:]*):\d+$/, '$1')
    .replace(/\.$/, '');
  if (!host || host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return '';
  if (ATS_HOSTS.some((ats) => host === ats || host.endsWith(`.${ats}`))) return '';
  while (HOST_PREFIXES.test(host) && host.split('.').length > 2) host = host.replace(HOST_PREFIXES, '');
  const suffix = PUBLIC_SUFFIXES.find((s) => host.endsWith(s) && host.length > s.length);
  if (suffix) host = host.slice(0, -suffix.length);
  const labels = host.split('.').filter(Boolean);
  return labels.at(-1) ?? '';
}

export function guessCompany(title: string | undefined, host: string): string {
  const named = title === undefined ? '' : fromTitle(title);
  return cut(named || fromHost(host));
}
