// Playwright-side helpers for the in-page harness (no extension loaded).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Frame, Page } from '@playwright/test';
import type { FieldReport } from '../../src/engine/types';
import type { IntentJson, Located, LocateOptions } from './harness/inpage';

export type { IntentJson, Located, LocateOptions };

const HARNESS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'harness', 'dist', 'harness.js');

/** A page or a frame; both can evaluate and take script tags. */
export type Target = Page | Frame;

/** Inject the harness bundle (idempotent) and wait for `window.__raf`. Re-inject after every navigation. */
export async function injectHarness(target: Target): Promise<void> {
  const present = await target.evaluate(() => typeof window.__raf !== 'undefined');
  if (!present) await target.addScriptTag({ path: HARNESS_PATH });
  await target.waitForFunction(() => typeof window.__raf !== 'undefined');
}

/**
 * Run discover + buildFieldContext in the page; returns the control id (and best evidence) whose best
 * evidence text normalizes to `label`. Throws, listing all controls, when none / several match
 * (pass `nth` to pick among several in document order).
 */
export function findControlByLabel(target: Target, label: string, opts: LocateOptions = {}): Promise<Located> {
  return target.evaluate(([l, o]) => window.__raf.locate(l, o), [label, opts] as const);
}

/** Find the control by label and run `executeStep` with an intent built from serializable JSON. */
export function execIntent(
  target: Target,
  label: string,
  intent: IntentJson,
  opts: LocateOptions & { timeoutMs?: number } = {},
): Promise<FieldReport> {
  return target.evaluate(([l, i, o]) => window.__raf.execIntent(l, i, o), [label, intent, opts] as const);
}

/** Page-level `__fixtureState()` (frames are merged under `frame.*` by the native fixture). */
export function fixtureState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => window.__fixtureState());
}
