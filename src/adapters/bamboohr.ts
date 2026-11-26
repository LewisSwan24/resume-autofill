import type { AtsAdapter } from './types';

// BambooHR draws its form with its own components (Fabric). The engine reads most of it; what it cannot:
// - A select of its own is a button that opens a listbox, named with the choice it shows ("Country United States").
//   Beside it a hidden select holds only that choice, a stand-in with no list to pick from.
// - The resume box is named "file-input"; the line above it says what it is for.
// - "Address" sits above separate City, State and Postcode boxes, so it is the street line.
export const bamboohr: AtsAdapter = {
  id: 'bamboohr',
  match: {
    urls: ['https://*.bamboohr.com/careers/*'],
    fingerprints: ['[data-fabric-component="FileUpload"] input[type="file"]', '[data-fabric-component~="SelectField"]'],
  },
  questions: [
    {
      control: '[data-fabric-component="Select"] button[aria-haspopup="listbox"]',
      within: '[data-fabric-component~="SelectField"]',
      text: 'label',
    },
    {
      control: '[data-fabric-component="FileUpload"] input[type="file"]',
      within: '[data-fabric-component="Flex"]:has(> [data-fabric-component="FileUpload"])',
      text: ':scope > p',
    },
  ],
  labels: [{ control: 'input[name="streetAddress.value"]', label: 'Street address' }],
  skip: ['[data-fabric-component="Select"] select[aria-hidden="true"]'],
};
