import { describe, expect, it } from 'vitest';
import { linesOfHtml } from '../../../src/import/extract/docx';
import { linesOfPage, type Piece } from '../../../src/import/extract/lines';
import { parseResume } from '../../../src/import/parse';

describe('import upgrades for diverse resume templates', () => {
  it('segments full-width header band above a two-column PDF body without scrambling left and right columns', () => {
    const pieces: Piece[] = [
      // Full-width top header band spanning across page center (x: 40..500)
      { text: 'Alice Chen — Software Engineer', x: 40, y: 760, width: 460, fontSize: 16 },
      { text: 'alice@example.com | +61 400 111 222', x: 40, y: 740, width: 320, fontSize: 10 },
      // Vertical gap (> 1.8 * lineHeight) into two-column main body: Left (x=40), Right (x=300)
      { text: 'Skills', x: 40, y: 660, width: 40, fontSize: 12 },
      { text: 'TypeScript', x: 40, y: 642, width: 65, fontSize: 10 },
      { text: 'React', x: 40, y: 626, width: 40, fontSize: 10 },
      { text: 'GraphQL', x: 40, y: 610, width: 55, fontSize: 10 },
      { text: 'Experience', x: 300, y: 660, width: 70, fontSize: 12 },
      { text: 'Acme Corp', x: 300, y: 642, width: 70, fontSize: 10 },
      { text: 'Backend Dev', x: 300, y: 626, width: 75, fontSize: 10 },
      { text: '2023-2025', x: 300, y: 610, width: 60, fontSize: 10 },
    ];
    const lines = linesOfPage(pieces, 1, 595).map((l) => l.text);
    expect(lines[0]).toContain('Alice Chen');
    expect(lines.slice(2, 6)).toEqual(['Skills', 'TypeScript', 'React', 'GraphQL']);
    expect(lines.slice(6)).toEqual(['Experience', 'Acme Corp', 'Backend Dev', '2023-2025']);
  });

  it('walks multi-section Word layout tables column by column instead of interleaving rows', () => {
    const html = `
      <table>
        <tr>
          <td>
            <h2>Contact</h2>
            <p>bob@example.com</p>
            <h2>Skills</h2>
            <p>Python, Go</p>
          </td>
          <td>
            <h2>Experience</h2>
            <p>Cloud Co | Engineer</p>
            <h2>Education</h2>
            <p>UNSW | Computer Science</p>
          </td>
        </tr>
      </table>
    `;
    const extracted = linesOfHtml(html).map((l) => l.text);
    const skillsIdx = extracted.indexOf('Skills');
    const expIdx = extracted.indexOf('Experience');
    expect(skillsIdx).toBeGreaterThan(-1);
    expect(expIdx).toBeGreaterThan(skillsIdx);
  });

  it('recognizes 2-cell bilingual headings with decorative separators', () => {
    const lines = [
      { text: '张三', cells: ['张三'], page: 1, fontSize: 16 },
      { text: '教育经历 Education', cells: ['教育经历', 'Education'], page: 1, fontSize: 12 },
      { text: '北京大学 计算机科学与技术 本科 2020-09 至 2024-06', cells: ['北京大学 计算机科学与技术 本科 2020-09 至 2024-06'], page: 1, fontSize: 10 },
      { text: '工作经历 ——', cells: ['工作经历', '——'], page: 1, fontSize: 12 },
      { text: '字节跳动有限公司 后端开发工程师 2024-07 - 至今', cells: ['字节跳动有限公司', '后端开发工程师', '2024-07 - 至今'], page: 1, fontSize: 10 },
    ];
    const draft = parseResume(lines);
    const val = (path: string) => draft.fields.find((f) => f.path === path)?.value ?? '';
    expect(val('education.0.school')).toContain('北京大学');
    expect(val('work.0.company')).toContain('字节跳动');
  });
});
