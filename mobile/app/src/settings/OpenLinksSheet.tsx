// 「用本 App 打开网申链接」: how to pick this app in WeChat, what 「仅此一次」 and 「始终」 do, how to undo it,
// and, only behind a button, the system's own default-browser dialog. The app never asks for the role by itself.
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import type { BrowserRolePlugin } from '../native/browserRole';
import { Sheet, type ToastMessage } from '../ui';

export interface OpenLinksSheetProps {
  open: boolean;
  onClose: () => void;
  browserRole: BrowserRolePlugin;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

type RoleState = { available: boolean; held: boolean } | null;

export function OpenLinksSheet({ open, onClose, browserRole, showToast }: OpenLinksSheetProps) {
  const t = useMT();
  const [role, setRole] = useState<RoleState>(null);

  const refresh = useCallback(async () => {
    try {
      setRole(await browserRole.state());
    } catch {
      setRole(null);
    }
  }, [browserRole]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const openSettings = async () => {
    let opened = false;
    try {
      opened = (await browserRole.openDefaultAppsSettings()).opened;
    } catch {
      opened = false;
    }
    if (!opened) showToast({ text: t('m.links.settingsFailed') });
  };

  const makeDefault = async () => {
    try {
      await browserRole.request();
    } catch {
      // The system dialog was not shown or was dismissed; the state line says where things stand.
    }
    await refresh();
  };

  return (
    <Sheet open={open} title={t('m.links.title')} onClose={onClose}>
      <div className="m-sheet-stack m-links">
        {role?.available ? (
          <p className="m-notice" aria-live="polite">
            <Icon name="signpost-split" />
            <span>{t(role.held ? 'm.links.stateHeld' : 'm.links.stateOther')}</span>
          </p>
        ) : null}
        <ol className="m-links__steps">
          <li>{t('m.links.step1')}</li>
          <li>{t('m.links.step2')}</li>
          <li>{t('m.links.step3')}</li>
        </ol>
        <p className="m-sheet-text">{t('m.links.undo')}</p>
        <button type="button" className="m-button m-button--wide" onClick={() => void openSettings()}>
          {t('m.links.openSettings')}
        </button>
        <p className="m-help">{t('m.links.inBrowser')}</p>
        {role?.available && !role.held ? (
          <button type="button" className="m-button m-button--wide" onClick={() => void makeDefault()}>
            {t('m.links.makeDefault')}
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}
