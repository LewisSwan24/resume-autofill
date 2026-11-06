// Registers every library driver. The native driver is the registry's built-in fallback.
import { antdDrivers } from './antd';
import { ariaAnswerButtonsDriver, ariaDriver } from './aria';
import { elementDrivers } from './element';
import { beisenDrivers } from './beisen';
import { feishuDrivers } from './feishu';
import { mokaDrivers } from './moka';
import { registerDriver } from './registry';
import { searchBoxDriver } from './searchBox';
import { workdayPromptDriver } from './workday/prompt';

let registered = false;

export function registerAllDrivers(): void {
  if (registered) return;
  registered = true;
  for (const d of [...antdDrivers, ...elementDrivers, ...mokaDrivers, ...feishuDrivers, ...beisenDrivers, ariaDriver, ariaAnswerButtonsDriver, searchBoxDriver, workdayPromptDriver]) registerDriver(d);
}
