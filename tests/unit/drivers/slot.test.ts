// Which element took over from a box the page swapped out, and which only looks like it did.
import { afterEach, describe, expect, it } from 'vitest';
import { slotOf } from '../../../src/drivers/slot';

afterEach(() => {
  document.body.innerHTML = '';
});

function swap(before: string, after: string): HTMLElement | null {
  document.body.innerHTML = `<form><div id="box">${before}</div></form>`;
  const slot = slotOf(document.querySelector('input')!);
  document.getElementById('box')!.innerHTML = after;
  return slot.find();
}

describe('a box that took over', () => {
  it.each([
    ['firstName', 'lastName'],
    ['address1', 'address2'],
    ['Email', 'Phone'],
    ['FirstName', 'LastName'],
    ['applicant[firstName]', 'applicant[lastName]'],
    ['first_name', 'last_name'],
    ['EMAIL', 'PHONE'],
    ['FIRST_NAME', 'LAST_NAME'],
    ['URL', 'DOB'],
    ['ctl00$txtEmail', 'ctl00$txtPhone'],
    ['fName', 'lName'],
    ['f_name', 'l_name'],
    ['linkedinURL', 'portfolioURL'],
    ['userID', 'userPIN'],
    ['address_1', 'address_2'],
    ['education[0][school]', 'education[1][school]'],
    ['q1', 'q2'],
  ])('is another field when %s became %s', (a, b) => {
    expect(swap(`<input name="${a}">`, `<input name="${b}">`)).toBeNull();
  });

  it.each([
    [':r3:', ':r9:'],
    ['a1b2c3', 'd4e5f6'],
    ['field_12', 'field_13'],
    ['react-select-3-input', 'react-select-5-input'],
    ['nTowvSy0v2', 'xQ7hTz2Lm1'],
    ['rnAbnpJH60', '6VXqEaLxIB'],
    ['cards[e78797e4][field0]', 'cards[0e361e70][field0]'],
    ['firstName', 'firstName'],
    [':ra:', ':rb:'],
    ['rc_select_3', 'rc_select_12'],
    ['el-id-1024-23', 'el-id-1024-31'],
    ['input_7', 'input_8'],
  ])('is the same field when %s became %s', (a, b) => {
    expect(swap(`<input name="${a}">`, `<input name="${b}">`)?.getAttribute('name')).toBe(b);
  });
});
