// Adapters for sites the general engine cannot fully read. Ashby needs none so far.
import { greenhouse } from './greenhouse';
import { lever } from './lever';
import type { AtsAdapter } from './types';
import { workable } from './workable';
import { workday } from './workday';

export const ADAPTERS: readonly AtsAdapter[] = [greenhouse, lever, workable, workday];
