// Writes the made-up resumes the phone app's import tests read. Everyone and everything in them is invented.
//   node mobile/scripts/make-import-fixtures.ts        (from the repository root)
// The files are kept in the repository, so tests need no browser. Run this only to change them.
// Same technique as scripts/make-resume-samples.ts: Chromium prints the PDFs, and the .docx is a zip built by hand.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const OUT = path.join('tests', 'unit', 'mobile', 'fixtures', 'import');
mkdirSync(OUT, { recursive: true });

const PAGE = `<style>
  @page { size: A4; margin: 18mm; }
  body { font: 10.5pt/1.45 Arial, 'Microsoft YaHei', sans-serif; color: #222; margin: 0; }
  h1 { font-size: 22pt; margin: 0 0 4pt; }
  h2 { font-size: 12.5pt; margin: 14pt 0 4pt; border-bottom: 1px solid #888; }
  p { margin: 2pt 0; }
  .row { display: flex; justify-content: space-between; font-weight: bold; }
  .page { page-break-before: always; }
  ul { margin: 2pt 0; padding-left: 14pt; }
</style>`;

const ZH_BODY = `
<h1>张三</h1>
<p>电话：13800138000　邮箱：zhangsan@example.com</p>
<p>现居城市：北京</p>
<h2>教育经历</h2>
<div class="row"><span>示例大学</span><span>2016.09 - 2020.06</span></div>
<p>计算机科学与技术　本科</p>
<h2>工作经历</h2>
<div class="row"><span>示例科技有限公司</span><span>2020.07 - 至今</span></div>
<p>前端工程师</p>
<ul><li>负责示例平台的前端开发，页面加载时间缩短 30%。</li><li>搭建团队的组件库和自动化测试。</li></ul>
<h2>项目经历</h2>
<div class="row"><span>示例项目</span><span>2021.03 - 2021.12</span></div>
<p>把旧的管理后台迁移到新的组件库。</p>
<h2>技能</h2>
<p>TypeScript、React</p>`;

const ZH = `${PAGE}${ZH_BODY}`;

/** More of the same kind, enough to fill two more pages. */
function morePages(): string {
  const projects = Array.from({ length: 14 }, (_, i) => {
    const n = i + 2;
    return `<div class="row"><span>示例项目${n}</span><span>2022.${String((i % 9) + 1).padStart(2, '0')} - 2022.12</span></div>
<p>为示例平台开发第 ${n} 个功能模块，包括需求梳理、界面开发和测试。</p>
<ul><li>和设计、后端同事一起拆分任务，按时交付。</li><li>补充单元测试，线上问题明显减少。</li></ul>`;
  });
  return `<div class="page"><h2>项目经历</h2>${projects.slice(0, 7).join('')}</div><div class="page">${projects.slice(7).join('')}</div>`;
}

const ZH_3PAGES = `${PAGE}${ZH_BODY}${morePages()}`;

const EN = `${PAGE}
<h1>Sam Example</h1>
<p>sam@example.com | +61 400 000 000 | Sydney NSW</p>
<h2>Experience</h2>
<div class="row"><span>Example Pty Ltd</span><span>Mar 2018 - Present</span></div>
<p>Developer</p>
<ul><li>Builds and maintains the booking website.</li></ul>
<h2>Education</h2>
<div class="row"><span>Example University</span><span>2014 - 2017</span></div>
<p>Bachelor of Science</p>`;

// Chinese headings and an English body, about as much of each (a Han character counts as four letters).
const MIXED = `${PAGE}
<h1>张三 Zhang San</h1>
<p>zhangsan@example.com | 13800138000 | 北京</p>
<h2>教育经历</h2>
<div class="row"><span>示例大学</span><span>2016.09 - 2020.06</span></div>
<p>Bachelor of Computer Science</p>
<h2>工作经历</h2>
<div class="row"><span>示例科技有限公司</span><span>2020.07 - 至今</span></div>
<p>Frontend Engineer</p>
<ul><li>Built the web front end of a booking product.</li><li>Wrote tests and set up the build pipeline.</li></ul>
<h2>技能</h2>
<p>TypeScript, React</p>`;

const NO_MATCH = `${PAGE}
<p>The garden behind the old house was quiet in the morning. Birds moved between the trees, and the light came slowly
over the wall, warming the stones along the path where moss had grown thick over many quiet seasons.</p>
<p>Later in the afternoon the wind picked up, and leaves gathered against the fence. Nobody came to sweep them away, so
they stayed there, turning brown and soft, until the rain arrived and carried most of them down the hill.</p>`;

// A word processor document is a zip of XML. This one needs nothing more than paragraphs and tables.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const b of data) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const packed = deflateRawSync(data);
    const nameBytes = Buffer.from(name, 'utf8');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc32(data), 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc32(data), 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(head, nameBytes, packed);
    central.push(entry, nameBytes);
    offset += head.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const para = (text: string): string => `<w:p><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
const cell = (text: string): string => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${para(text)}</w:tc>`;
const table = (rows: string[][]): string => `<w:tbl><w:tblPr/>${rows.map((r) => `<w:tr>${r.map(cell).join('')}</w:tr>`).join('')}</w:tbl>`;

function docx(body: string): Buffer {
  return zip({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`,
  });
}

const ZH_DOCX = docx(
  para('张三') +
    para('电话：13800138000　邮箱：zhangsan@example.com') +
    para('现居城市：北京') +
    para('教育经历') +
    table([['示例大学', '2016.09 - 2020.06'], ['计算机科学与技术', '本科']]) +
    para('工作经历') +
    table([['示例科技有限公司', '2020.07 - 至今'], ['前端工程师', '']]) +
    para('负责示例平台的前端开发，页面加载时间缩短 30%。') +
    para('搭建团队的组件库和自动化测试。') +
    para('项目经历') +
    table([['示例项目', '2021.03 - 2021.12']]) +
    para('把旧的管理后台迁移到新的组件库。') +
    para('技能') +
    para('TypeScript、React'),
);

const browser = await chromium.launch();
const page = await browser.newPage();
async function pdf(name: string, html: string): Promise<void> {
  await page.setContent(`<!doctype html><meta charset="utf-8">${html}`);
  await page.pdf({ path: path.join(OUT, name), format: 'A4', preferCSSPageSize: true, printBackground: false });
}
await pdf('zh-zhangsan.pdf', ZH);
await pdf('zh-zhangsan-3pages.pdf', ZH_3PAGES);
await pdf('en-sample.pdf', EN);
await pdf('mixed.pdf', MIXED);
await pdf('no-match.pdf', NO_MATCH);
await browser.close();

writeFileSync(path.join(OUT, 'zh-zhangsan.docx'), ZH_DOCX);
console.log('written to', OUT);
