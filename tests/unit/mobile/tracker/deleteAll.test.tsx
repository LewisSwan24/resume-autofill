// Delete all names the 网申 records.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DeleteAllSheet } from '../../../../mobile/app/src/settings/DeleteAllSheet';
import { createMemoryFileStore } from '../../../../mobile/app/src/store/fileStore';
import { BackStackContext, createBackStack } from '../../../../mobile/app/src/ui';
import { setLanguage } from '../../../../src/i18n';

beforeEach(() => setLanguage('zh'));
afterEach(cleanup);

const sheet = (recordCount: number) =>
  render(
    <BackStackContext.Provider value={createBackStack()}>
      <DeleteAllSheet
        open
        onClose={() => undefined}
        profile={null}
        files={createMemoryFileStore()}
        recordCount={recordCount}
        onExportFirst={() => undefined}
        onWipe={async () => true}
      />
    </BackStackContext.Provider>,
  );

describe('DeleteAllSheet', () => {
  it('lists the records line and no recent-pages line', () => {
    sheet(3);
    expect(screen.getByText('3 条网申记录和对应的提醒')).toBeTruthy();
    expect(screen.queryByText(/最近的网申页面/)).toBeNull();
  });

  it('English uses the singular for one record', () => {
    setLanguage('en');
    sheet(1);
    expect(screen.getByText(/^1 application and its reminders$/)).toBeTruthy();
  });
});
