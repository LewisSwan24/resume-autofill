// Writes the made-up resumes the import tests read. Everyone and everything in them is invented.
//   node scripts/make-resume-samples.ts
// The files are kept in the repository, so tests do not need a browser or qpdf. Run this only to change them.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const OUT = path.join('fixtures', 'resume-samples');
mkdirSync(OUT, { recursive: true });

const PAGE = `<style>
  @page { size: A4; margin: 18mm; }
  body { font: 10.5pt/1.45 Arial, 'Microsoft YaHei', sans-serif; color: #222; margin: 0; }
  h1 { font-size: 22pt; margin: 0 0 4pt; }
  h2 { font-size: 12.5pt; margin: 14pt 0 4pt; border-bottom: 1px solid #888; }
  p { margin: 2pt 0; }
  .row { display: flex; justify-content: space-between; font-weight: bold; }
  .columns { display: grid; grid-template-columns: 62mm 1fr; gap: 8mm; }
  ul { margin: 2pt 0; padding-left: 14pt; }
</style>`;

const ZH_SINGLE = `${PAGE}
<h1>林知远</h1>
<p>电话：13800138000　邮箱：zhiyuan.lin@example.com</p>
<p>现居城市：上海　个人主页：https://zhiyuan.example.com</p>
<h2>教育经历</h2>
<div class="row"><span>华东示例大学</span><span>2015.09 - 2019.06</span></div>
<p>计算机科学与技术　本科</p>
<h2>工作经历</h2>
<div class="row"><span>示例科技有限公司</span><span>2021.03 - 至今</span></div>
<p>高级前端工程师</p>
<ul><li>负责招聘系统前端架构，页面加载时间缩短 40%。</li><li>带领五人小组完成组件库迁移。</li></ul>
<div class="row"><span>虚构网络有限公司</span><span>2019.07 - 2021.02</span></div>
<p>前端工程师</p>
<ul><li>开发内部数据看板。</li></ul>
<h2>技能</h2>
<p>TypeScript、React、Node.js</p>`;

const EN_SINGLE = `${PAGE}
<h1>Zhiyuan (Leo) Lin</h1>
<p>Brisbane QLD | 0412 345 678 | zhiyuan.lin@example.com | linkedin.com/in/zhiyuan-lin-example</p>
<h2>Experience</h2>
<div class="row"><span>Example Software Pty Ltd</span><span>Mar 2021 - Present</span></div>
<p>Senior Frontend Engineer</p>
<ul><li>Led the move of a hiring product to a new component library.</li><li>Cut page load time by 40%.</li></ul>
<div class="row"><span>Made Up Networks</span><span>Jul 2019 - Feb 2021</span></div>
<p>Frontend Engineer</p>
<ul><li>Built internal dashboards.</li></ul>
<h2>Education</h2>
<div class="row"><span>University of Example</span><span>2015 - 2019</span></div>
<p>Bachelor of Computer Science</p>
<h2>Skills</h2>
<p>TypeScript, React, Node.js</p>`;

const EN_TWO_COLUMNS = `${PAGE}
<h1>Mia Harper</h1>
<div class="columns">
  <div>
    <h2>Contact</h2>
    <p>mia.harper@example.com</p>
    <p>+61 400 111 222</p>
    <p>Melbourne VIC</p>
    <h2>Skills</h2>
    <p>Figma</p><p>User research</p><p>Prototyping</p>
    <h2>Education</h2>
    <p><b>Example Institute of Design</b></p>
    <p>Bachelor of Design</p>
    <p>2014 - 2017</p>
  </div>
  <div>
    <h2>Experience</h2>
    <div class="row"><span>Fictional Studio</span><span>Feb 2020 - Present</span></div>
    <p>Lead Product Designer</p>
    <ul><li>Runs design for a booking product used by clinics.</li><li>Set up a monthly research panel with patients.</li></ul>
    <div class="row"><span>Pretend Agency</span><span>Jan 2018 - Jan 2020</span></div>
    <p>Product Designer</p>
    <ul><li>Designed sites for local councils.</li></ul>
  </div>
</div>`;

// A word processor document is a zip of XML. These two need nothing more than paragraphs and one table.
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
const para = (text: string, style = ''): string =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
const cell = (text: string): string => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${para(text)}</w:tc>`;
const table = (rows: string[][]): string => `<w:tbl><w:tblPr/>${rows.map((r) => `<w:tr>${r.map(cell).join('')}</w:tr>`).join('')}</w:tbl>`;

function docx(body: string): Buffer {
  return zip({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`,
  });
}

const ZH_TABLE_DOCX = docx(
  para('个人简历') +
    table([
      ['姓名：', '林知远', '性别：', '男'],
      ['电话：', '13800138000', '邮箱：', 'zhiyuan.lin@example.com'],
      ['现居城市：', '上海', '政治面貌：', '群众'],
    ]) +
    para('教育经历') +
    table([['2015.09 - 2019.06', '华东示例大学', '计算机科学与技术', '本科']]) +
    para('工作经历') +
    table([['2021.03 - 至今', '示例科技有限公司', '高级前端工程师']]) +
    para('负责招聘系统前端架构，页面加载时间缩短 40%。') +
    table([['2019.07 - 2021.02', '虚构网络有限公司', '前端工程师']]) +
    para('开发内部数据看板。') +
    para('技能') +
    para('TypeScript、React、Node.js'),
);

const EN_DOCX = docx(
  para('Noah Bennett') +
    para('Sydney NSW | noah.bennett@example.com | 0400 222 333') +
    para('Work Experience') +
    para('Sample Logistics, Operations Analyst, June 2019 - Present') +
    para('Built the weekly report on late deliveries.') +
    para('Imaginary Freight, Graduate Analyst, Feb 2017 - May 2019') +
    para('Cleaned shipment data.') +
    para('Education') +
    para('University of Nowhere, Bachelor of Commerce, 2013 - 2016') +
    para('Skills') +
    para('Excel, SQL'),
);

const browser = await chromium.launch();
const page = await browser.newPage();
async function pdf(name: string, html: string): Promise<void> {
  await page.setContent(`<!doctype html><meta charset="utf-8">${html}`);
  await page.pdf({ path: path.join(OUT, name), format: 'A4', preferCSSPageSize: true, printBackground: false });
}
await pdf('zh-single.pdf', ZH_SINGLE);
await pdf('en-single.pdf', EN_SINGLE);
await pdf('en-two-columns.pdf', EN_TWO_COLUMNS);

// A scan: one picture of text, and no text in the file.
await page.setContent(`<!doctype html><canvas id="c" width="800" height="400"></canvas>`);
const picture = await page.evaluate(() => {
  const canvas = document.querySelector('canvas')!;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 800, 400);
  g.fillStyle = '#000';
  g.font = '40px Arial';
  g.fillText('Scanned resume', 40, 100);
  return canvas.toDataURL('image/png');
});
await pdf('image-only.pdf', `<img src="${picture}" style="width:160mm">`);
await browser.close();

writeFileSync(path.join(OUT, 'zh-table.docx'), ZH_TABLE_DOCX);
writeFileSync(path.join(OUT, 'en.docx'), EN_DOCX);
// The old binary format starts with this signature, and nothing here reads further than that.
writeFileSync(path.join(OUT, 'old-format.doc'), Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(504)]));

// The open password is made up too. It exists to prove that the extension never asks for one.
execFileSync('qpdf', ['--encrypt', 'made-up-password', 'made-up-owner', '256', '--', path.join(OUT, 'en-single.pdf'), path.join(OUT, 'encrypted.pdf')]);
console.log('written to', OUT);
