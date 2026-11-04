// Adapters for sites the general engine cannot fully read. Greenhouse and Ashby need none so far.
import { lever } from './lever';
import type { AtsAdapter } from './types';
import { workday } from './workday';

export const ADAPTERS: readonly AtsAdapter[] = [lever, workday];
