// Words only the mobile app uses. Shared words (module and field names, "unset", "undo"...) come from src/i18n;
// this dictionary is looked up first and falls back to it, so the shared dictionaries stay untouched.
import { useCallback } from 'react';
import { translate, useLanguage, type Language, type MessageParams } from '../../../src/i18n';

const zh = {
  'm.title': '简历资料',
  'm.modules': '简历模块',
  'm.editing': '正在编辑',
  'm.resumes': '我的简历',
  'm.newZh': '新建中文简历',
  'm.newEn': '新建英文简历',
  'm.defaultTitle.zh': '我的中文简历',
  'm.defaultTitle.en': 'My English resume',
  'm.rename': '改名',
  'm.renameLabel': '简历名称',
  'm.renameSave': '保存名称',
  'm.delete': '删除这份简历',
  'm.deleted': '已删除「{name}」',
  'm.empty': '这里还空着，建一份简历吧。',
  'm.filled': '已填 {n} 项',
  'm.notFilled': '还没填',
  'm.entries': '{n} 条',
  'm.back': '返回',
  'm.close': '关闭',
  'm.more': '更多操作：{name}',
  'm.addTo': '添加{name}',
  'm.removeValue': '删除{value}',
  'm.listPlaceholder': '可用逗号隔开',
  'm.yes': '是',
  'm.no': '否',
  'm.loadFailed': '读不出简历资料：{message}',
  'm.zhTag': '中',
  'm.enTag': 'EN',
} as const;

export type MobileKey = keyof typeof zh;

const en: Record<MobileKey, string> = {
  'm.title': 'Resume details',
  'm.modules': 'Resume sections',
  'm.editing': 'Editing',
  'm.resumes': 'Your resumes',
  'm.newZh': 'New Chinese resume',
  'm.newEn': 'New English resume',
  'm.defaultTitle.zh': '我的中文简历',
  'm.defaultTitle.en': 'My English resume',
  'm.rename': 'Rename',
  'm.renameLabel': 'Resume name',
  'm.renameSave': 'Save name',
  'm.delete': 'Delete this resume',
  'm.deleted': 'Deleted "{name}"',
  'm.empty': 'Nothing here yet. Start a resume?',
  'm.filled': '{n} filled',
  'm.notFilled': 'Not started',
  'm.entries': '{n} entries',
  'm.back': 'Back',
  'm.close': 'Close',
  'm.more': 'More actions: {name}',
  'm.addTo': 'Add to {name}',
  'm.removeValue': 'Remove {value}',
  'm.listPlaceholder': 'Separate with commas',
  'm.yes': 'Yes',
  'm.no': 'No',
  'm.loadFailed': "Couldn't read your resume data: {message}",
  'm.zhTag': '中',
  'm.enTag': 'EN',
};

const MOBILE: Record<Language, Record<string, string>> = { zh, en };

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (params[name] === undefined ? whole : String(params[name])));
}

export function mt(language: Language, key: string, params?: MessageParams): string {
  const own = MOBILE[language][key];
  return own === undefined ? translate(language, key, params) : interpolate(own, params);
}

/** `t` for the mobile app: mobile words first, then the shared dictionary. Re-renders on language change. */
export function useMT(): (key: MobileKey | (string & {}), params?: MessageParams) => string {
  const language = useLanguage();
  return useCallback((key, params) => mt(language, key, params), [language]);
}
