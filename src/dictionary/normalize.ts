// Text normalization shared by the dictionaries, classifier and option matcher.

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
const CJK_RUN = /[\u3400-\u9fff\uf900-\ufaff]+/g;

export function hasCjk(s: string): boolean {
  return CJK.test(s);
}

/**
 * Traditional characters a form or a resume can use, each followed by its simplified form. For comparing only: the
 * dictionaries are written in simplified, and what is typed into a page is never changed by this.
 */
const TRADITIONAL_PAIRS = [
  '薦荐暱昵慣惯動动轄辖詳详鏈链倉仓僱雇擁拥崗岗傭佣幣币劑剂峽峡紹绍滿满譽誉勵励幹干踐践頒颁喪丧眾众亞亚屆届脫脱',
  '遞递媽妈沒没鄰邻刪删聞闻孫孙轅辕鮮鲜閭闾顓颛駟驷夾夹宮宫諸诸遲迟欄栏熱热',
  '狀状絡络壽寿貸贷貿贸賬账帳账銜衔籃篮橋桥廈厦樂乐歐欧賓宾濱滨偉伟傑杰鵬鹏軒轩陣阵綠绿絕绝',
  '學学歷历曆历業业畢毕專专經经驗验職职務务類类別别電电話话號号碼码郵邮聯联繫系係系體体請请輸输選选擇择寫写時时間间開开結结貫贯國国語语證证書书護护駕驾駛驶況况歲岁齡龄實实習习項项數数據据單单機机構构負负責责內内簡简個个資资訊讯',
  '檔档傳传現现當当區区縣县鎮镇環环處处會会員员關关親亲屬属緊紧組组織织團团隊队獲获獎奖級级與与為为從从來来們们給给對对應应於于無无點点網网頁页連连稱称長长興兴愛爱備备註注週周費费額额標标題题導导師师課课績绩創创辦办設设計计發发',
  '測测試试運运營营銷销財财醫医軍军農农黨党聲声諾诺權权閱阅讀读覽览認认確确條条約约隱隐爾尔歡欢謝谢貴贵門门問问見见視视覺觉觀观義义議议論论評评價价優优勢势總总陳陈說说細细節节層层廠厂廣广東东華华蘇苏陝陕閩闽滬沪漢汉臺台灣湾裡里',
  '裏里後后麼么這这還还進进過过達达遠远適适邊边際际陸陆隨随離离難难雙双萬万億亿幾几歸归復复複复徵征統统綜综線线紀纪續续維维編编緣缘縮缩繳缴聽听讓让識识調调謂谓貼贴買买賣卖贊赞質质輔辅轉转較较輕轻釋释錄录鍵键鐘钟銀银錢钱鐵铁閉闭',
  '陽阳陰阴險险雜杂靜静頭头顧顾預预領领風风飛飞館馆馬马駐驻髮发鳥鸟麗丽龍龙齊齐產产畫画異异盡尽監监碩硕礎础稅税穩稳競竞筆笔範范簽签籤签繼继羅罗膽胆臨临舉举舊旧藝艺衛卫補补裝装製制規规觸触訂订託托記记訪访詞词詢询該该誠诚誰谁講讲',
  '謀谋譯译變变貨货賽赛贈赠趙赵跡迹車车軟软輪轮迴回遊游遷迁鄉乡針针鋼钢錯错閒闲階阶隻只雲云響响順顺願愿飯饭養养圖图鑑鉴參参並并僑侨償偿儲储兒儿冊册劃划勞劳協协卻却啟启嚴严園园圍围壓压場场報报夠够夢梦奮奋婦妇寧宁審审寶宝島岛帶带',
  '幫帮庫库廳厅張张彈弹徑径態态懷怀戶户掃扫掛挂換换擔担擴扩攝摄敗败斷断暫暂極极樣样樓楼榮荣檢检殘残氣气決决溝沟準准潔洁濟济燈灯爭争獨独獻献療疗盤盘禮礼禪禅種种積积穀谷窮穷紅红純纯終终緒绪練练羣群脈脉腦脑萊莱葉叶藍蓝蘭兰虛虚螢萤',
  '術术討讨訓训許许診诊誤误諮咨貢贡購购鄧邓靈灵頻频餘余黃黄',
].join('');
const TO_SIMPLIFIED = new Map<string, string>();
for (let i = 0; i + 1 < TRADITIONAL_PAIRS.length; i += 2) TO_SIMPLIFIED.set(TRADITIONAL_PAIRS[i]!, TRADITIONAL_PAIRS[i + 1]!);
/** The same thing in other words, in Taiwan and Hong Kong. */
const REGIONAL_WORDS: [RegExp, string][] = [
  [/联络/g, '联系'],
  [/电邮/g, '邮箱'],
  [/身分/g, '身份'],
  [/专案/g, '项目'],
  [/到职/g, '到岗'],
  [/行动电话/g, '手机'],
];

export function toSimplified(s: string): string {
  let t = s.replace(CJK_RUN, (run) => Array.from(run, (c) => TO_SIMPLIFIED.get(c) ?? c).join(''));
  for (const [re, word] of REGIONAL_WORDS) t = t.replace(re, word);
  return t;
}

// Boilerplate that carries no field meaning. Order matters: phrases first, punctuation afterwards.
const NOISE_PHRASES: RegExp[] = [
  /\b(?:required|optional)\b/g,
  /\bplease\s+(?:enter|select|input|choose|fill\s+in|type|provide|upload)\b/g,
  /(?:非必填|必填|选填|必选)/g,
  /请(?:输入|选择|填写|选填|上传|选)/g,
  // How to write the answer, in brackets after the question: 籍贯（填写格式：xx省xx市）. Brackets are half-width by now.
  /\((?:填写|书写)?格式(?:为)?:[^)]*\)/g,
  // What to do, in brackets after the question: 是否为全日制在校学生（非全日制、非在校不可参加实习，请联系您的招聘HR）.
  /\([^)]*(?:请|不可|不能|须|如有|若有)[^)]*\)/g,
  // How long the answer may be: 自我评价（200字以内）, 限500字, (max 500 characters), in no more than 150 words.
  /(?:不超过|不少于|不多于|限|最多|至少|字数)?\s*\d+\s*(?:[-~至到]\s*\d+\s*)?个?字(?:以内|以下|以上|左右|内)?/g,
  /\b(?:(?:answer|respond|reply)\s+)?(?:in\s+)?(?:no more than|not more than|not exceeding|max(?:imum)?\.?(?:\s+of)?|up to|under|within|less than|fewer than|at most|limit(?:ed)? to)\s*\d+\s*(?:words?|characters?|chars?)\b/g,
  /\b\d+\s*(?:-\s*\d+\s*)?(?:words?|characters?|chars?)(?:\s*(?:max(?:imum)?|limit|or less|or fewer))?\b/g,
];

// ( ) [ ] * : plus sentence punctuation. Full-width forms are already folded by NFKC.
const PUNCTUATION = /[*:()[\]?!;,。、]/g;

/**
 * Canonical comparable form of a label: NFKC (full-width → half-width), lower-case, noise phrases
 * and decoration removed, whitespace collapsed (and dropped between adjacent CJK characters).
 */
export function normalizeLabel(s: string): string {
  const seen = NORMALIZED.get(s);
  if (seen !== undefined) return seen;
  const t = normalizedAnew(s);
  if (s.length <= MAX_REMEMBERED_LENGTH) {
    if (NORMALIZED.size >= MAX_REMEMBERED) NORMALIZED.clear();
    NORMALIZED.set(s, t);
  }
  return t;
}

/** Every label is compared with every synonym, over and over: the same few thousand strings come through all the time. */
const NORMALIZED = new Map<string, string>();
const MAX_REMEMBERED = 20_000;
const MAX_REMEMBERED_LENGTH = 200;

function normalizedAnew(s: string): string {
  // Accents on Latin letters only: the marks on Japanese kana are other code points, and they do change a word.
  let t = s.normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC').toLowerCase();
  t = toSimplified(t);
  t = t.replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u2013\u2014]/g, '-');
  t = t.replace(/\(s\)/g, 's');
  for (const re of NOISE_PHRASES) t = t.replace(re, ' ');
  t = t.replace(PUNCTUATION, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/(?<=[\u3400-\u9fff\uf900-\ufaff]) (?=[\u3400-\u9fff\uf900-\ufaff])/g, '');
  return t;
}

/** Aggressive key for exact comparisons: normalized, then spaces / hyphens / slashes / dots / apostrophes dropped. */
export function compactKey(s: string): string {
  return normalizeLabel(s).replace(/[\s\-_/.'"·]/g, '');
}

/** CJK characters as unigrams + bigrams, latin/digit words as lower-case words. De-duplicated, in order. */
export function tokens(s: string): string[] {
  const n = normalizeLabel(s);
  const out: string[] = [];
  let cursor = 0;
  const pushWords = (chunk: string) => {
    for (const w of chunk.split(/[^a-z0-9+#]+/)) if (w) out.push(w);
  };
  for (const m of n.matchAll(CJK_RUN)) {
    pushWords(n.slice(cursor, m.index));
    const run = m[0];
    const chars = [...run];
    out.push(...chars);
    for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i]! + chars[i + 1]!);
    cursor = m.index + run.length;
  }
  pushWords(n.slice(cursor));
  return [...new Set(out)];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LATIN_PHRASE = /^[a-z0-9 .'\-/&+#]+$/;

/**
 * Whether `text` contains `phrase` (both should already be normalized).
 * Phrases without CJK must start (mode 'prefix') or start and end (mode 'word') on a word boundary,
 * so "man" is not found in "woman". CJK-bearing phrases match as plain substrings.
 */
export function containsPhrase(text: string, phrase: string, mode: 'word' | 'prefix' = 'word'): boolean {
  if (!phrase) return false;
  if (!LATIN_PHRASE.test(phrase)) return text.includes(phrase);
  const tail = mode === 'word' ? '(?![a-z0-9])' : '';
  return new RegExp(`(?<![a-z0-9])${escapeRe(phrase)}${tail}`).test(text);
}
