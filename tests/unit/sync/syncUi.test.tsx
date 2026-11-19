// Sync UIs: receiver fingerprints instead of the sender's own hashes, hash validation, and no file deletion before a save.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { SyncPanel } from '../../../entrypoints/options/SyncPanel';
import { SyncSheet } from '../../../mobile/app/src/settings/SyncSheet';
import { defaultAppState } from '../../../mobile/app/src/store/appStateStore';
import { createMemoryFileStore } from '../../../mobile/app/src/store/fileStore';
import { setLanguage } from '../../../src/i18n';
import { createSampleProfile } from '../../../src/schema';
import { listFiles, putFile, resetFileStoreForTests } from '../../../src/storage';
import { buildRafArchive, sha256Hex } from '../../../src/sync';

const PASS = 'ui-sync-pass-1';
const enc = (s: string) => new TextEncoder().encode(s);
let writeText: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  setLanguage('en');
  fakeBrowser.reset();
  await resetFileStoreForTests();
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  cleanup();
});

/** A full archive whose resume 0 points to a new remote file; the receiver's unreferenced file becomes an orphan. */
async function incomingFullArchive() {
  const incoming = createSampleProfile();
  incoming.resumes[0]!.updatedAt = Date.now() + 60_000;
  incoming.resumes[0]!.attachments.resumeFileId = 'remote-cv';
  return buildRafArchive({
    profile: incoming,
    mode: 'full',
    password: PASS,
    attachments: [{ id: 'remote-cv', name: 'cv.pdf', type: 'application/pdf', bytes: enc('%PDF remote') }],
  });
}

describe('extension SyncPanel', () => {
  it('offers "Copy my file fingerprints" (not the sender-hash prefill) and copies this device\'s hashes', async () => {
    await putFile({ id: 'a', name: 'a.pdf', type: 'application/pdf', blob: new Blob([enc('file-a')]) });
    await putFile({ id: 'b', name: 'b.png', type: 'image/png', blob: new Blob([enc('file-b')]) });
    render(<SyncPanel profile={createSampleProfile()} onApplyProfile={async () => undefined} />);
    fireEvent.click(screen.getByLabelText(/delta mode/));
    expect(screen.queryByRole('button', { name: 'Use current local hashes' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Copy my file fingerprints' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = String(writeText.mock.calls[0]![0]).split('\n').sort();
    expect(copied).toEqual([await sha256Hex(enc('file-a')), await sha256Hex(enc('file-b'))].sort());
  });

  it('rejects known-hash entries that are not SHA-256 and does not export', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    render(<SyncPanel profile={createSampleProfile()} onApplyProfile={async () => undefined} />);
    fireEvent.click(screen.getByLabelText(/delta mode/));
    fireEvent.change(screen.getByLabelText(/receiver already has/), { target: { value: `${'a'.repeat(64)}\ndeadbeef` } });
    fireEvent.change(screen.getByLabelText(/Encryption passphrase/), { target: { value: PASS } });
    fireEvent.click(screen.getByRole('button', { name: 'Export encrypted .raf' }));
    expect(await screen.findByText(/Not a SHA-256 fingerprint: deadbeef/)).toBeTruthy();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  async function importAndMerge(onApplyProfile: () => Promise<void>) {
    await putFile({ id: 'local-orphan', name: 'old.pdf', type: 'application/pdf', blob: new Blob([enc('old')]) });
    render(<SyncPanel profile={createSampleProfile()} onApplyProfile={onApplyProfile} />);
    fireEvent.change(screen.getByLabelText('Import .raf / encrypted'), {
      target: { files: [new File([await incomingFullArchive()], 'x.raf')] },
    });
    await screen.findByText('Unlock encrypted sync package', undefined, { timeout: 5000 });
    const passInputs = screen.getAllByLabelText(/Encryption passphrase/);
    fireEvent.change(passInputs[passInputs.length - 1]!, { target: { value: PASS } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByRole('region', { name: 'Sync merge preview' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Merge selected' }));
  }

  it('keeps local files and shows the error when saving the merged profile fails', async () => {
    await importAndMerge(async () => {
      throw new Error('disk full');
    });
    expect(await screen.findByText(/could not be saved.*disk full/, undefined, { timeout: 5000 })).toBeTruthy();
    expect((await listFiles()).map((f) => f.id)).toContain('local-orphan');
  });

  it('deletes orphaned files only after the profile is saved', async () => {
    const onApply = vi.fn(async () => undefined);
    await importAndMerge(onApply);
    await waitFor(async () => expect((await listFiles()).map((f) => f.id)).not.toContain('local-orphan'), { timeout: 5000 });
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});

describe('mobile SyncSheet', () => {
  function renderSheet(over: Partial<Parameters<typeof SyncSheet>[0]> & { files: ReturnType<typeof createMemoryFileStore> }) {
    const profile = createSampleProfile();
    return render(
      <SyncSheet
        open
        onClose={() => undefined}
        profile={profile}
        readStoredProfile={async () => profile}
        appState={defaultAppState()}
        updateAppState={async () => true}
        showToast={() => undefined}
        {...over}
      />,
    );
  }

  it('copies this device\'s file fingerprints for the sender', async () => {
    const files = createMemoryFileStore();
    await files.put({ name: 'cv.pdf', type: 'application/pdf', bytes: enc('phone-cv') });
    renderSheet({ files });
    fireEvent.click(screen.getByRole('button', { name: 'Copy my file fingerprints' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('')));
    expect(writeText.mock.calls[0]![0]).toBe(await sha256Hex(enc('phone-cv')));
  });

  it('keeps files and shows the error when saving the synced data fails', async () => {
    const files = createMemoryFileStore();
    const orphan = await files.put({ name: 'old.pdf', type: 'application/pdf', bytes: enc('old') });
    renderSheet({
      files,
      onApplyProfile: async () => undefined,
      updateAppState: async () => {
        throw new Error('disk full');
      },
    });
    fireEvent.change(screen.getByLabelText('Import .raf / encrypted'), {
      target: { files: [new File([await incomingFullArchive()], 'x.raf')] },
    });
    await screen.findByRole('button', { name: 'Unlock archive' }, { timeout: 5000 });
    const passInputs = screen.getAllByLabelText('Passphrase (min 8 chars)');
    fireEvent.change(passInputs[passInputs.length - 1]!, { target: { value: PASS } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock archive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Smart merge (by timestamp)' }, { timeout: 5000 }));
    expect(await screen.findByText(/could not be saved.*disk full/, undefined, { timeout: 5000 })).toBeTruthy();
    expect(await files.list()).toContain(orphan.id);
  });
});
