// Inline SVG icons (Bootstrap Icons, MIT, 16x16 grid, fill = currentColor) - DESIGN-SYSTEM §4.4.
//
// Icons are imported one by one (Vite `?raw`) and listed in the explicit ICONS registry below, so ONLY the listed
// icons end up in the bundle (a dynamic `icons/` + name import would pull in all ~2000). To use a new icon, import it
// and add it to ICONS; the type of `name` follows automatically.
//
// Rules from the design system: one icon means one thing everywhere; status icons always sit next to a word
// (see ./status.ts); icons are decorative (aria-hidden) unless given a `label`.
import fileEarmarkText from 'bootstrap-icons/icons/file-earmark-text.svg?raw';
import fileEarmarkCheck from 'bootstrap-icons/icons/file-earmark-check.svg?raw';
import checkCircle from 'bootstrap-icons/icons/check-circle.svg?raw';
import exclamationCircle from 'bootstrap-icons/icons/exclamation-circle.svg?raw';
import questionCircle from 'bootstrap-icons/icons/question-circle.svg?raw';
import xCircle from 'bootstrap-icons/icons/x-circle.svg?raw';
import infoCircle from 'bootstrap-icons/icons/info-circle.svg?raw';
import exclamationTriangle from 'bootstrap-icons/icons/exclamation-triangle.svg?raw';
import xLg from 'bootstrap-icons/icons/x-lg.svg?raw';
import searchSearch from 'bootstrap-icons/icons/search.svg?raw';
import arrowClockwise from 'bootstrap-icons/icons/arrow-clockwise.svg?raw';
import chevronDown from 'bootstrap-icons/icons/chevron-down.svg?raw';
import chevronUp from 'bootstrap-icons/icons/chevron-up.svg?raw';
import arrowUp from 'bootstrap-icons/icons/arrow-up.svg?raw';
import arrowDown from 'bootstrap-icons/icons/arrow-down.svg?raw';
import trashTrash from 'bootstrap-icons/icons/trash.svg?raw';
import plusLg from 'bootstrap-icons/icons/plus-lg.svg?raw';
import uploadUpload from 'bootstrap-icons/icons/upload.svg?raw';
import threeDots from 'bootstrap-icons/icons/three-dots.svg?raw';
import checkLg from 'bootstrap-icons/icons/check-lg.svg?raw';
import pencilPencil from 'bootstrap-icons/icons/pencil.svg?raw';
import boxArrowUpRight from 'bootstrap-icons/icons/box-arrow-up-right.svg?raw';
import gearGear from 'bootstrap-icons/icons/gear.svg?raw';
import layoutSidebarReverse from 'bootstrap-icons/icons/layout-sidebar-reverse.svg?raw';
import paperclip from 'bootstrap-icons/icons/paperclip.svg?raw';
import arrowCounterclockwise from 'bootstrap-icons/icons/arrow-counterclockwise.svg?raw';
import downloadDownload from 'bootstrap-icons/icons/download.svg?raw';
import arrowLeftRight from 'bootstrap-icons/icons/arrow-left-right.svg?raw';
import copyCopy from 'bootstrap-icons/icons/copy.svg?raw';
import link45deg from 'bootstrap-icons/icons/link-45deg.svg?raw';
import personVcard from 'bootstrap-icons/icons/person-vcard.svg?raw';
import bookBook from 'bootstrap-icons/icons/book.svg?raw';

export const ICONS = {
  'file-earmark-text': fileEarmarkText,
  'file-earmark-check': fileEarmarkCheck,
  'check-circle': checkCircle,
  'exclamation-circle': exclamationCircle,
  'question-circle': questionCircle,
  'x-circle': xCircle,
  'info-circle': infoCircle,
  'exclamation-triangle': exclamationTriangle,
  'x-lg': xLg,
  'search': searchSearch,
  'arrow-clockwise': arrowClockwise,
  'chevron-down': chevronDown,
  'chevron-up': chevronUp,
  'arrow-up': arrowUp,
  'arrow-down': arrowDown,
  'trash': trashTrash,
  'plus-lg': plusLg,
  'upload': uploadUpload,
  'three-dots': threeDots,
  'check-lg': checkLg,
  'pencil': pencilPencil,
  'box-arrow-up-right': boxArrowUpRight,
  'gear': gearGear,
  'layout-sidebar-reverse': layoutSidebarReverse,
  'paperclip': paperclip,
  'arrow-counterclockwise': arrowCounterclockwise,
  'download': downloadDownload,
  'arrow-left-right': arrowLeftRight,
  'copy': copyCopy,
  'link-45deg': link45deg,
  'person-vcard': personVcard,
  'book': bookBook,
} as const satisfies Record<string, string>;

export type IconName = keyof typeof ICONS;

/** Names of every registered icon, in registry order. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/** Markup between `<svg ...>` and `</svg>` of each icon, computed once. */
const INNER_MARKUP = Object.fromEntries(
  (Object.entries(ICONS) as Array<[IconName, string]>).map(([name, raw]) => [name, raw.replace(/^[\s\S]*?<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim()]),
) as Record<IconName, string>;

export interface IconProps {
  name: IconName;
  /** Edge length: a number is px, a string is any CSS length. Defaults to `var(--raf-size-glyph)` (20px). */
  size?: number | string;
  /** Accessible name. Without it the icon is decorative (`aria-hidden`); with it the icon is `role="img"`. */
  label?: string;
  className?: string;
}

export function Icon({ name, size = 'var(--raf-size-glyph)', label, className }: IconProps) {
  const markup = INNER_MARKUP[name];
  const cls = className ? `raf-icon ${className}` : 'raf-icon';
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={cls}
      data-icon={name}
      focusable="false"
      style={{ width: size, height: size, flex: 'none', display: 'inline-block', verticalAlign: 'middle' }}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      // The markup comes from the bootstrap-icons package (trusted, static), never from user input.
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
