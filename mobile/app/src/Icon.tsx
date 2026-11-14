// Bootstrap Icons for the mobile app, same approach as src/ui/Icon.tsx: each icon imported by name (`?raw`) so
// only these end up in the bundle. One icon means one thing everywhere (Lively Icons, "Icon meanings").
import arrowDown from 'bootstrap-icons/icons/arrow-down.svg?raw';
import arrowLeft from 'bootstrap-icons/icons/arrow-left.svg?raw';
import arrowUp from 'bootstrap-icons/icons/arrow-up.svg?raw';
import briefcase from 'bootstrap-icons/icons/briefcase.svg?raw';
import bullseye from 'bootstrap-icons/icons/bullseye.svg?raw';
import chatLeftText from 'bootstrap-icons/icons/chat-left-text.svg?raw';
import chatQuote from 'bootstrap-icons/icons/chat-quote.svg?raw';
import checkLg from 'bootstrap-icons/icons/check-lg.svg?raw';
import chevronDown from 'bootstrap-icons/icons/chevron-down.svg?raw';
import chevronRight from 'bootstrap-icons/icons/chevron-right.svg?raw';
import chevronUp from 'bootstrap-icons/icons/chevron-up.svg?raw';
import exclamationTriangle from 'bootstrap-icons/icons/exclamation-triangle.svg?raw';
import globe2 from 'bootstrap-icons/icons/globe2.svg?raw';
import houseHeart from 'bootstrap-icons/icons/house-heart.svg?raw';
import kanban from 'bootstrap-icons/icons/kanban.svg?raw';
import lifePreserver from 'bootstrap-icons/icons/life-preserver.svg?raw';
import mortarboard from 'bootstrap-icons/icons/mortarboard.svg?raw';
import passport from 'bootstrap-icons/icons/passport.svg?raw';
import patchCheck from 'bootstrap-icons/icons/patch-check.svg?raw';
import pencil from 'bootstrap-icons/icons/pencil.svg?raw';
import people from 'bootstrap-icons/icons/people.svg?raw';
import person from 'bootstrap-icons/icons/person.svg?raw';
import personCheck from 'bootstrap-icons/icons/person-check.svg?raw';
import plusLg from 'bootstrap-icons/icons/plus-lg.svg?raw';
import telephone from 'bootstrap-icons/icons/telephone.svg?raw';
import threeDots from 'bootstrap-icons/icons/three-dots.svg?raw';
import tools from 'bootstrap-icons/icons/tools.svg?raw';
import translate from 'bootstrap-icons/icons/translate.svg?raw';
import trash from 'bootstrap-icons/icons/trash.svg?raw';
import trophy from 'bootstrap-icons/icons/trophy.svg?raw';
import xLg from 'bootstrap-icons/icons/x-lg.svg?raw';
import arrowRepeat from 'bootstrap-icons/icons/arrow-repeat.svg?raw';
import fileEarmarkPdf from 'bootstrap-icons/icons/file-earmark-pdf.svg?raw';
import fileEarmarkText from 'bootstrap-icons/icons/file-earmark-text.svg?raw';
import image from 'bootstrap-icons/icons/image.svg?raw';
import paperclip from 'bootstrap-icons/icons/paperclip.svg?raw';
import upload from 'bootstrap-icons/icons/upload.svg?raw';
import houseIcon from 'bootstrap-icons/icons/house.svg?raw';
import personVcard from 'bootstrap-icons/icons/person-vcard.svg?raw';
import gearIcon from 'bootstrap-icons/icons/gear.svg?raw';
import link45deg from 'bootstrap-icons/icons/link-45deg.svg?raw';
import clipboardIcon from 'bootstrap-icons/icons/clipboard.svg?raw';
import copyIcon from 'bootstrap-icons/icons/copy.svg?raw';
import downloadIcon from 'bootstrap-icons/icons/download.svg?raw';
import lockIcon from 'bootstrap-icons/icons/lock.svg?raw';
import eyeIcon from 'bootstrap-icons/icons/eye.svg?raw';
import eyeSlash from 'bootstrap-icons/icons/eye-slash.svg?raw';
import globeIcon from 'bootstrap-icons/icons/globe.svg?raw';
import shieldIcon from 'bootstrap-icons/icons/shield.svg?raw';
import infoCircle from 'bootstrap-icons/icons/info-circle.svg?raw';
import checkCircle from 'bootstrap-icons/icons/check-circle.svg?raw';
import exclamationCircle from 'bootstrap-icons/icons/exclamation-circle.svg?raw';
import sendSlash from 'bootstrap-icons/icons/send-slash.svg?raw';
import clipboardCheck from 'bootstrap-icons/icons/clipboard-check.svg?raw';
import listUl from 'bootstrap-icons/icons/list-ul.svg?raw';
import inputCursorText from 'bootstrap-icons/icons/input-cursor-text.svg?raw';
import type { ModuleName } from '../../../src/editor';

const ICONS = {
  'arrow-down': arrowDown,
  'arrow-left': arrowLeft,
  'arrow-up': arrowUp,
  briefcase,
  bullseye,
  'chat-left-text': chatLeftText,
  'chat-quote': chatQuote,
  'check-lg': checkLg,
  'chevron-down': chevronDown,
  'chevron-right': chevronRight,
  'chevron-up': chevronUp,
  'exclamation-triangle': exclamationTriangle,
  globe2,
  'house-heart': houseHeart,
  kanban,
  'life-preserver': lifePreserver,
  mortarboard,
  passport,
  'patch-check': patchCheck,
  pencil,
  people,
  person,
  'person-check': personCheck,
  'plus-lg': plusLg,
  telephone,
  'three-dots': threeDots,
  tools,
  translate,
  trash,
  trophy,
  'x-lg': xLg,
  'arrow-repeat': arrowRepeat,
  'file-earmark-pdf': fileEarmarkPdf,
  'file-earmark-text': fileEarmarkText,
  image,
  paperclip,
  upload,
  'house': houseIcon,
  'person-vcard': personVcard,
  'gear': gearIcon,
  'link-45deg': link45deg,
  'clipboard': clipboardIcon,
  'copy': copyIcon,
  'download': downloadIcon,
  'lock': lockIcon,
  'eye': eyeIcon,
  'eye-slash': eyeSlash,
  'globe': globeIcon,
  'shield': shieldIcon,
  'info-circle': infoCircle,
  'check-circle': checkCircle,
  'exclamation-circle': exclamationCircle,
  'send-slash': sendSlash,
  'clipboard-check': clipboardCheck,
  'list-ul': listUl,
  'input-cursor-text': inputCursorText,
} as const satisfies Record<string, string>;

export type IconName = keyof typeof ICONS;

/** The icon of each module in the module list. */
export const MODULE_ICONS: Record<ModuleName, IconName> = {
  basics: 'person',
  contact: 'telephone',
  workRights: 'passport',
  jobIntention: 'bullseye',
  education: 'mortarboard',
  work: 'briefcase',
  projects: 'kanban',
  campus: 'people',
  awards: 'trophy',
  languages: 'translate',
  certificates: 'patch-check',
  skills: 'tools',
  family: 'house-heart',
  emergencyContact: 'life-preserver',
  referees: 'person-check',
  diversity: 'globe2',
  about: 'chat-quote',
  customAnswers: 'chat-left-text',
  attachments: 'paperclip',
};

const INNER = Object.fromEntries(
  Object.entries(ICONS).map(([name, raw]) => [name, raw.replace(/^[\s\S]*?<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim()]),
) as Record<IconName, string>;

/** Decorative unless `label` is given. Sized by CSS (`--m-icon`, 24px on touch screens). */
export function Icon({ name, label, className }: { name: IconName; label?: string; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className ? `m-icon ${className}` : 'm-icon'}
      data-icon={name}
      focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      // Static markup from the bootstrap-icons package, never user input.
      dangerouslySetInnerHTML={{ __html: INNER[name] }}
    />
  );
}
