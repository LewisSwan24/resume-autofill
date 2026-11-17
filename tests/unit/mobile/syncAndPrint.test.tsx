import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { defaultAppState } from '../../../mobile/app/src/store/appStateStore';
import { createMemoryFileStore } from '../../../mobile/app/src/store/fileStore';
import { setLanguage } from '../../../src/i18n';
import { printResumeOffline, type PrintBridgePlugin } from '../../../mobile/app/src/native/printBridge';
import { SyncSheet } from '../../../mobile/app/src/settings/SyncSheet';
import { TemplateExportSheet } from '../../../mobile/app/src/settings/TemplateExportSheet';
import { createSampleProfile } from '../../../src/schema';
import { unlockSyncArchive } from '../../../src/sync';

beforeEach(() => {
  setLanguage('en');
});

afterEach(() => {
  cleanup();
});

describe('mobile SyncSheet & TemplateExportSheet', () => {
  it('exports encrypted .raf with stored attachments and unlocks cleanly', async () => {
    const profile = createSampleProfile();
    const files = createMemoryFileStore();
    const savedFile = await files.put({
      name: 'cv.pdf',
      type: 'application/pdf',
      bytes: new TextEncoder().encode('%PDF-1.4 sample binary'),
    });
    profile.resumes[0]!.attachments.resumeFileId = savedFile.id;

    let exportedBytes: Uint8Array | null = null;
    let exportedName = '';
    const saveDocument = vi.fn(async (file: { name: string; mimeType: string; bytes: Uint8Array }) => {
      exportedName = file.name;
      exportedBytes = file.bytes;
      return 'saved' as const;
    });

    render(
      <SyncSheet
        open
        onClose={() => undefined}
        profile={profile}
        readStoredProfile={async () => profile}
        files={files}
        appState={defaultAppState()}
        updateAppState={async () => true}
        saveDocument={saveDocument}
        showToast={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText('Passphrase (min 8 chars)'), { target: { value: 'mobile-pass-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export encrypted .raf' }));

    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(1), { timeout: 6000 });
    expect(exportedName).toBe('resume-autofill-full.raf');
    expect(exportedBytes).not.toBeNull();

    const unlocked = await unlockSyncArchive(exportedBytes!, 'mobile-pass-123');
    expect(unlocked.attachments).toHaveLength(1);
    expect(unlocked.attachments[0]!.name).toBe('cv.pdf');
  });

  it('calls native PrintBridge when available and saves .docx in TemplateExportSheet', async () => {
    const profile = createSampleProfile();
    profile.activeResumeId = 'sample-en';
    const printMock: PrintBridgePlugin = {
      printHtml: vi.fn(async () => ({ started: true })),
    };
    const saveDocument = vi.fn(async () => 'saved' as const);

    render(
      <TemplateExportSheet
        open
        onClose={() => undefined}
        profile={profile}
        saveDocument={saveDocument}
        printBridge={printMock}
        showToast={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Print / Save PDF' }));
    await waitFor(() => expect(printMock.printHtml).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Save Word (.docx)' }));
    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(1));
  });

  it('printResumeOffline falls back when native PrintBridge throws', async () => {
    const failingBridge: PrintBridgePlugin = {
      printHtml: vi.fn(async () => {
        throw new Error('UNIMPLEMENTED');
      }),
    };
    const ok = await printResumeOffline('<html><body>hi</body></html>', 'resume', failingBridge);
    expect(ok).toBe(true);
  });
});
