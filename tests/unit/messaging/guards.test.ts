import { beforeEach, describe, expect, it } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  MESSAGE_TYPES,
  isFromContentScript,
  isFromExtension,
  isFromExtensionPage,
  isValidMessage,
} from '../../../src/messaging';

const extId = () => browser.runtime.id;
const base = () => browser.runtime.getURL('');

beforeEach(() => {
  fakeBrowser.reset();
});

describe('isFromExtension', () => {
  it('accepts a sender with our extension id', () => {
    expect(isFromExtension({ id: extId() })).toBe(true);
  });
  it('rejects other ids, missing ids and missing senders', () => {
    expect(isFromExtension({ id: 'someone-else' })).toBe(false);
    expect(isFromExtension({})).toBe(false);
    expect(isFromExtension(undefined)).toBe(false);
  });
});

describe('isFromContentScript', () => {
  const tab = { id: 7 };

  it('requires same id AND a tab', () => {
    expect(isFromContentScript({ id: extId(), tab, url: 'https://jobs.example.com/apply' })).toBe(true);
    expect(isFromContentScript({ id: extId() })).toBe(false);
    expect(isFromContentScript({ id: 'other', tab })).toBe(false);
    expect(isFromContentScript(undefined)).toBe(false);
  });
});

describe('isFromExtensionPage', () => {
  it('accepts same-id senders whose url is inside the extension origin', () => {
    expect(isFromExtensionPage({ id: extId(), url: `${base()}sidepanel.html` })).toBe(true);
    expect(isFromExtensionPage({ id: extId(), url: `${base()}options.html#x` })).toBe(true);
  });
  it('rejects web pages, content scripts on web pages, foreign ids and missing urls', () => {
    expect(isFromExtensionPage({ id: extId(), url: 'https://evil.example.com/' })).toBe(false);
    expect(isFromExtensionPage({ id: extId() })).toBe(false);
    expect(isFromExtensionPage({ id: 'other', url: `${base()}sidepanel.html` })).toBe(false);
    expect(isFromExtensionPage(undefined)).toBe(false);
  });
  it('is not fooled by a lookalike prefix', () => {
    const lookalike = `${base().replace(/\/$/, '')}.evil.com/x`;
    expect(isFromExtensionPage({ id: extId(), url: lookalike })).toBe(false);
  });
});

describe('isValidMessage', () => {
  it('accepts every known type', () => {
    for (const type of MESSAGE_TYPES) expect(isValidMessage({ type })).toBe(true);
  });
  it('knows the full documented set, including ui:* messages', () => {
    expect([...MESSAGE_TYPES].sort()).toEqual(
      [
        'scan:result',
        'scan:total',
        'fill:request',
        'fill:commitPreview',
        'fill:cancelPreview',
        'scan:query',
        'wizard:query',
        'wizard:clear',
        'wizard:updated',
        'wizard:autoAdvance',
        'wizard:stopAdvance',
        'frame:stepState',
        'frame:pressNext',
        'frame:needs',
        'frame:preview',
        'frame:fill',
        'report:updated',
        'preview:updated',
        'field:focus',
        'frame:focus',
        'field:apply',
        'frame:apply',
        'field:fill',
        'frame:fillOne',
        'fill:retry',
        'frame:alive',
        'field:captureFingerprint',
        'frame:captureFingerprint',
        'ui:openOptions',
        'ui:openSidePanel',
        'inspector:start',
        'inspector:stop',
        'inspector:hover',
        'inspector:picked',
        'frame:inspectorStart',
        'frame:inspectorStop',
      ].sort(),
    );
  });
  it('rejects unknown types and non-messages', () => {
    expect(isValidMessage({ type: 'nope' })).toBe(false);
    expect(isValidMessage({ type: 5 })).toBe(false);
    expect(isValidMessage({})).toBe(false);
    expect(isValidMessage(null)).toBe(false);
    expect(isValidMessage(undefined)).toBe(false);
    expect(isValidMessage('fill:request')).toBe(false);
    expect(isValidMessage([])).toBe(false);
    expect(isValidMessage({ type: 'toString' })).toBe(false);
    expect(isValidMessage({ type: '__proto__' })).toBe(false);
  });
});
