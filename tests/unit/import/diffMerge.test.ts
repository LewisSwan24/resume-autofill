import { describe, expect, it } from 'vitest';
import { applyDiffMergeDecisions, buildResumeDiffPlan } from '../../../src/import/diffMerge';
import { ResumeSchema } from '../../../src/schema';

describe('Structured 3-way diff merge importer', () => {
  it('computes field diffs, deduplicates append_new items, and respects explicit user choices', () => {
    const existing = ResumeSchema.parse({
      id: 'base',
      title: 'Existing',
      locale: 'zh-CN',
      basics: { familyName: '李', givenName: '华' },
      contact: { email: 'lihua@old.example' },
      work: [
        { company: 'AlphaTech', position: 'Backend Engineer', startDate: '2022-01', description: 'Old desc' },
      ],
      skills: [{ name: 'TypeScript', level: 'Proficient' }],
    });

    const incoming = ResumeSchema.parse({
      id: 'imported',
      title: 'Imported PDF',
      locale: 'zh-CN',
      basics: { familyName: '李', givenName: '华' },
      contact: { email: 'lihua@new.example', phone: '13900001111' },
      work: [
        { company: 'AlphaTech', position: 'Backend Engineer', startDate: '2022-01', description: 'New desc' },
        { company: 'BetaCloud', position: 'Senior Engineer', startDate: '2024-03', description: 'New job' },
      ],
      skills: [{ name: 'TypeScript', level: '' }, { name: 'Rust', level: '' }],
    });

    const plan = buildResumeDiffPlan(existing, incoming);
    const phoneDiff = plan.scalars.find((s) => s.id === 'contact.phone');
    const emailDiff = plan.scalars.find((s) => s.id === 'contact.email');
    expect(phoneDiff?.kind).toBe('added');
    expect(phoneDiff?.defaultDecision).toBe('use_incoming');
    expect(emailDiff?.kind).toBe('changed');
    expect(emailDiff?.defaultDecision).toBe('keep_existing');

    const workSection = plan.arrays.find((a) => a.section === 'work');
    expect(workSection?.newItemCount).toBe(1);
    expect(workSection?.defaultDecision).toBe('append_new');

    // Apply defaults + override email to use_incoming
    const merged = applyDiffMergeDecisions(existing, incoming, { 'contact.email': 'use_incoming' });
    expect(merged.contact.email).toBe('lihua@new.example');
    expect(merged.contact.phone).toBe('13900001111');
    expect(merged.work).toHaveLength(2);
    expect(merged.work[0]?.description).toBe('Old desc'); // existing preserved, duplicate skipped
    expect(merged.work[1]?.company).toBe('BetaCloud');
    expect(merged.skills.map((s) => s.name)).toEqual(['TypeScript', 'Rust']);
  });
});
