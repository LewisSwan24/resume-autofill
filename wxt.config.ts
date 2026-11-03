import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '网申简历一键填写助手 / Resume Autofill',
    description: 'One-click autofill of job application forms from a locally stored resume.',
    permissions: ['storage', 'unlimitedStorage', 'sidePanel', 'webNavigation', 'tabs'],
    host_permissions: ['<all_urls>'],
    side_panel: { default_path: 'sidepanel.html' },
    action: { default_title: '网申简历一键填写助手 / Resume Autofill' },
  },
});