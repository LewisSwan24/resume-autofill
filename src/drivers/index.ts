// Registers every library driver. The native driver is the registry's built-in fallback.
import { antdDrivers } from './antd';
import { ariaAnswerButtonsDriver, ariaDriver } from './aria';
import { elementDrivers } from './element';
import { registerDriver } from './registry';
import { searchBoxDriver } from './searchBox';

let registered = false;

export function registerAllDrivers(): void {
  if (registered) return;
  registered = true;
  for (const d of [...antdDrivers, ...elementDrivers, ariaDriver, ariaAnswerButtonsDriver, searchBoxDriver]) registerDriver(d);
}
