// Options tab: Offline JD Match Analyzer + Non-Destructive Variant Studio + Declarative SiteRecipe Manager.
import { useRef, useState } from 'react';
import { addResume } from '../../src/editor';
import { useT } from '../../src/i18n';
import {
  BUILTIN_SITE_RECIPES,
  diffRecipePacks,
  exportRecipesJson,
  exportSignedRecipePack,
  parseAndVerifyRecipePack,
  type RecipePackDiff,
} from '../../src/recipes';
import {
  ResumeSchema,
  ensureEntryIds,
  hiddenIndicesToIds,
  materializeResume,
  type Profile,
  type Resume,
} from '../../src/schema';
import {
  analyzeResumeAgainstJd,
  buildVariantMetaFromJd,
  generateTailoredSummaryDraft,
  type JdAnalysisResult,
  type TailoredRewriteDraft,
} from '../../src/tailor';
import { Badge, Button, EmptyState, Field, Notice, Textarea } from './ui/controls';
import { useToast } from './ui/Toast';

interface TailorPanelProps {
  profile: Profile;
  resume: Resume | null;
  onCommit: (next: Profile, options?: { immediate?: boolean }) => Promise<void>;
  onSelectResume: (id: string) => void;
}

export function TailorPanel({ profile, resume, onCommit, onSelectResume }: TailorPanelProps) {
  const t = useT();
  const toast = useToast();
  const [jdText, setJdText] = useState('');
  const [analysis, setAnalysis] = useState<JdAnalysisResult | null>(null);
  const [rewrite, setRewrite] = useState<TailoredRewriteDraft | null>(null);
  const [draftSummary, setDraftSummary] = useState('');
  const [rewriting, setRewriting] = useState(false);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  const [pendingDiff, setPendingDiff] = useState<{
    diff: RecipePackDiff;
    recipes: Awaited<ReturnType<typeof parseAndVerifyRecipePack>>['recipes'];
  } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const customRecipes = profile.recipes ?? [];
  // A variant is matched as it fills: with what it inherits from its base.
  const view = resume ? materializeResume(resume, profile.resumes) : null;

  const handleAnalyze = () => {
    if (!view || !jdText.trim()) return;
    setRewrite(null);
    setAnalysis(analyzeResumeAgainstJd(view, jdText));
  };

  const handleRewrite = async () => {
    if (!view || !analysis) return;
    setRewriting(true);
    try {
      const res = await generateTailoredSummaryDraft({
        resume: view,
        targetRole: analysis.targetRole,
        matchedKeywords: analysis.matchedKeywords,
        settings: profile.settings,
      });
      if (res) {
        setRewrite(res);
        setDraftSummary(res.rewrittenText);
      }
    } finally {
      setRewriting(false);
    }
  };

  const handleSaveVariant = async () => {
    if (!resume || !analysis) return;
    const baseId = resume.variantOf ?? resume.id;
    // Hidden entries are keyed by entry id, so the entries of the analysed resume and its bases get ids first.
    const chain = new Set<string>();
    for (let cursor: Resume | undefined = resume; cursor && !chain.has(cursor.id); ) {
      chain.add(cursor.id);
      const parentId: string | undefined = cursor.variantOf;
      cursor = profile.resumes.find((r) => r.id === parentId);
    }
    const resumes = profile.resumes.map((r) => (chain.has(r.id) ? ensureEntryIds(r) : r));
    const analysed = materializeResume(resumes.find((r) => r.id === resume.id) ?? resume, resumes);
    const overlay = hiddenIndicesToIds(buildVariantMetaFromJd(analysed, analysis), analysed);
    if (draftSummary.trim()) overlay.customSummary = draftSummary.trim();
    const roleLabel = analysis.targetRole || 'JD';
    const title = `${resume.title} · ${roleLabel}`.slice(0, 80);
    // Only identity and the overlay: every other field is empty, so the variant follows its base until edited.
    const variant = ResumeSchema.parse({
      id: crypto.randomUUID(),
      title,
      locale: resume.locale,
      variantOf: baseId,
      variantMeta: overlay,
    });
    const next = addResume({ ...profile, resumes }, variant, { activate: true });
    await onCommit(next, { immediate: true });
    onSelectResume(variant.id);
    toast.push({ text: t('options.tailor.variantSaved', { title }) });
  };

  const handleExportRecipes = () => {
    const json = exportRecipesJson([...customRecipes, ...BUILTIN_SITE_RECIPES]);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `resume-autofill-recipes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleExportSignedRecipes = async () => {
    const json = await exportSignedRecipePack([...customRecipes, ...BUILTIN_SITE_RECIPES]);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `resume-autofill-recipes-signed-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleImportRecipes = async (file: File | undefined) => {
    if (!file) return;
    setRecipeError(null);
    setPendingDiff(null);
    try {
      const parsed = await parseAndVerifyRecipePack(await file.text());
      const diff = diffRecipePacks(customRecipes, parsed.recipes, parsed.verifiedDigest);
      setPendingDiff({ diff, recipes: parsed.recipes });
    } catch (e) {
      setRecipeError(t('options.recipes.importError', { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const handleApplyRecipeDiff = async () => {
    if (!pendingDiff) return;
    const byId = new Map(customRecipes.map((r) => [r.id, r]));
    for (const rec of pendingDiff.recipes) byId.set(rec.id, rec);
    const next = { ...profile, recipes: Array.from(byId.values()) };
    await onCommit(next, { immediate: true });
    toast.push({ text: t('options.recipes.importDone', { n: pendingDiff.recipes.length }) });
    setPendingDiff(null);
  };

  return (
    <div className="raf-form-stack">
      <section className="raf-card raf-form-stack" aria-label={t('options.tailor.title')}>
        <h2 className="raf-heading">{t('options.tailor.title')}</h2>
        <p className="raf-caption">{t('options.tailor.lead')}</p>

        {!resume ? (
          <EmptyState icon="file-earmark-text">{t('options.empty')}</EmptyState>
        ) : (
          <>
            <Field label={t('options.tailor.jdLabel')}>
              {(ctrl) => (
                <Textarea
                  {...ctrl}
                  rows={5}
                  value={jdText}
                  placeholder={t('options.tailor.jdPlaceholder')}
                  onChange={(e) => setJdText(e.target.value)}
                />
              )}
            </Field>
            <div className="raf-row-actions">
              <Button variant="primary" disabled={!jdText.trim()} onClick={handleAnalyze}>
                {t('options.tailor.analyze')}
              </Button>
              {analysis ? (
                <>
                  <Button disabled={rewriting} onClick={() => void handleRewrite()}>
                    {t('options.tailor.rewriteSummary')}
                  </Button>
                  <Button variant="primary" onClick={() => void handleSaveVariant()}>
                    {t('options.tailor.saveVariant')}
                  </Button>
                </>
              ) : null}
            </div>

            {analysis ? (
              <div className="raf-form-stack">
                <Notice tone="info">
                  {t('options.tailor.score', {
                    score: analysis.matchScore,
                    hit: analysis.matchedKeywords.length,
                    total: analysis.totalKeywords,
                  })}
                </Notice>
                <div>
                  <strong>{t('options.tailor.matched')}: </strong>
                  {analysis.matchedKeywords.map((kw) => (
                    <Badge key={kw}>{kw}</Badge>
                  ))}
                </div>
                {analysis.missingKeywords.length > 0 ? (
                  <p className="raf-caption">
                    <strong>{t('options.tailor.missing')}: </strong>
                    {analysis.missingKeywords.join(', ')}
                  </p>
                ) : null}
              </div>
            ) : null}

            {rewrite ? (
              <div className="raf-form-stack">
                <p className="raf-caption">
                  {rewrite.source === 'bm25'
                    ? t('options.tailor.source.template')
                    : t('options.tailor.source.ai', { source: t(`panel.ai.source.${rewrite.source}`) })}
                </p>
                {rewrite.fallbackUsed ? (
                  <Notice tone="info">
                    {rewrite.source === 'bm25'
                      ? t('options.tailor.fallbackTemplate')
                      : t(`panel.ai.fallbackNotice.${rewrite.source}`)}
                  </Notice>
                ) : null}
                {!rewrite.factCheck.ok ? (
                  <Notice tone="danger">
                    {t('options.tailor.factWarn', { metrics: rewrite.factCheck.inventedMetrics.join(', ') })}
                  </Notice>
                ) : null}
                <Field label={t('options.field.selfIntroduction')}>
                  {(ctrl) => (
                    <Textarea
                      {...ctrl}
                      rows={4}
                      value={draftSummary}
                      onChange={(e) => setDraftSummary(e.target.value)}
                    />
                  )}
                </Field>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="raf-card raf-form-stack" aria-label={t('options.recipes.title')}>
        <h2 className="raf-heading">{t('options.recipes.title')}</h2>
        <p className="raf-caption">{t('options.recipes.lead')}</p>
        <p className="raf-caption">
          {t('options.recipes.builtinCount', {
            n: BUILTIN_SITE_RECIPES.length,
            custom: customRecipes.length,
          })}
        </p>
        {recipeError ? <Notice tone="danger">{recipeError}</Notice> : null}
        <div className="raf-row-actions">
          <Button onClick={handleExportRecipes}>{t('options.recipes.export')}</Button>
          <Button onClick={() => void handleExportSignedRecipes()}>{t('options.recipes.exportSigned')}</Button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              void handleImportRecipes(f);
            }}
          />
          <Button onClick={() => importRef.current?.click()}>{t('options.recipes.import')}</Button>
        </div>
        {pendingDiff ? (
          <div className="raf-sync-box" role="region" aria-label={t('options.recipes.title')}>
            <Notice tone={pendingDiff.diff.verifiedDigest ? 'info' : 'danger'}>
              {t(pendingDiff.diff.verifiedDigest ? 'options.recipes.signedVerified' : 'options.recipes.unsignedDiff', {
                added: pendingDiff.diff.added.length,
                updated: pendingDiff.diff.updated.length,
                unchanged: pendingDiff.diff.unchangedCount,
              })}
            </Notice>
            <div className="raf-row">
              <Button variant="primary" onClick={() => void handleApplyRecipeDiff()}>
                {t('options.recipes.applyDiff')}
              </Button>
              <Button onClick={() => setPendingDiff(null)}>{t('options.notNow')}</Button>
            </div>
          </div>
        ) : null}
        {customRecipes.length > 0 ? (
          <ul>
            {customRecipes.map((r) => (
              <li key={r.id} className="raf-caption">
                {r.name} ({r.hostPattern}) · {r.rules.length}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
