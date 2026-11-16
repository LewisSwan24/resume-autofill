// 「清除网站登录状态」: confirm, then ask the fill browser to clear cookies, web storage and cache of every site.
// Resumes and attachments are not touched (they live in ProfileVault, not in the WebView).
import { useState } from 'react';
import { ConfirmSheet } from '../dialogs';
import { useMT } from '../i18n';
import type { ToastMessage } from '../ui';

export interface ClearSiteDataSheetProps {
  open: boolean;
  onClose: () => void;
  clearSiteData: () => Promise<void>;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export function ClearSiteDataSheet({ open, onClose, clearSiteData, showToast }: ClearSiteDataSheetProps) {
  const t = useMT();
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    let ok = true;
    try {
      await clearSiteData();
    } catch {
      ok = false;
    }
    setBusy(false);
    onClose();
    showToast({ text: t(ok ? 'm.settings.siteDataDone' : 'm.settings.siteDataFailed') });
  };
  return (
    <ConfirmSheet
      open={open}
      title={t('m.settings.siteDataTitle')}
      text={t('m.settings.siteDataText')}
      confirmLabel={t('m.settings.siteDataConfirm')}
      danger
      busy={busy}
      onConfirm={() => void confirm()}
      onClose={onClose}
    />
  );
}
