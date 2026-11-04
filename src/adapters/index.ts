// Adapters for sites the general engine cannot fully read. Greenhouse and Ashby need none so far.
import { lever } from './lever';
import type { AtsAdapter } from './types';

export const ADAPTERS: readonly AtsAdapter[] = [lever];
