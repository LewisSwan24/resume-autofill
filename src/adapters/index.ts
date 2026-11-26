// Adapters for sites the general engine cannot fully read.
import { ashby } from './ashby';
import { beisen, bytedanceCampus, feishu, moka, nowcoderCampus, tencentCareers } from './cnPortals';
import { greenhouse } from './greenhouse';
import { lever } from './lever';
import { pageup } from './pageup';
import { personio } from './personio';
import { rippling } from './rippling';
import { smartrecruiters } from './smartrecruiters';
import { successfactors } from './successfactors';
import type { AtsAdapter } from './types';
import { workable } from './workable';
import { workday } from './workday';

export const ADAPTERS: readonly AtsAdapter[] = [
  greenhouse,
  lever,
  workable,
  workday,
  successfactors,
  pageup,
  ashby,
  smartrecruiters,
  rippling,
  personio,
  moka,
  beisen,
  // Before ByteDance: on a domain of its own, a form of this system is Feishu's.
  feishu,
  bytedanceCampus,
  nowcoderCampus,
  tencentCareers,
];
