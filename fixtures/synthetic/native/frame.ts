import '../shared/style.css';
import { StateRegistry, installFixtureState } from '../shared/state';

const reg = new StateRegistry();
reg.add('noticePeriod', document.querySelector<HTMLElement>('#notice-period')!);
reg.add('earliestStartDate', document.querySelector<HTMLElement>('#earliest-start')!);

// Unprefixed here; the parent page re-exposes these as `frame.noticePeriod` etc.
installFixtureState(() => reg.snapshot());
