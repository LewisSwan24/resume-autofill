import { describe, expect, it } from 'vitest';
import { askedFor } from '../../../src/dictionary/asked';

describe('askedFor: what a question asks the applicant for', () => {
  it.each([
    // A live Breezy application, second section.
    ["Let's get started! Can we get your first name, please?", 'first name'],
    ['Thanks! What about your last name?', 'last name'],
    ["What's your email address?", 'email address'],
    ['How about your best contact phone number?', 'contact phone number'],
    ['What is your date of birth?', 'date of birth'],
    ['Please list your Passport number', 'Passport number'],
    // Other common ways of asking.
    ['What are your salary expectations?', 'salary expectations'],
    ['Could we have your mobile number so we can reach you?', 'mobile number'],
    ['Please enter your full name as it appears on your passport', 'full name'],
    ['Please provide your LinkedIn profile URL.', 'LinkedIn profile URL'],
    ['What’s your preferred name? *', 'preferred name'],
    // Where the applicant is.
    ['What city are you based in?', 'current city'],
    ['Which suburb do you currently live in?', 'current city'],
    ['Where are you currently located?', 'current location'],
    ['Where do you live?', 'current location'],
    // Asked about what the applicant holds or has.
    ['What visa type do you currently hold?', 'visa type'],
    ['Which visa are you currently on?', 'visa'],
    ['What qualifications do you have?', 'qualifications'],
  ])('%s → %s', (label, asked) => {
    expect(askedFor(label)).toBe(asked);
  });

  it.each([
    ['请输入您的手机号码', '手机号码'],
    ['请填写你的邮箱', '邮箱'],
    ['您的出生日期是？', '出生日期'],
    ['请问你的名字是什么？', '名字'],
    ['請輸入您的電子郵件', '电子邮件'],
  ])('%s → %s', (label, asked) => {
    expect(askedFor(label)).toBe(asked);
  });

  it.each([
    // Someone else's, or not asked for at all.
    'What is the full name of the person who referred you?',
    'What is the country of origin of your passport?',
    'Do you have your own car or access to one?',
    'How would you rate your English communication and comprehension skills?',
    'Is there anything else you would like to tell us about your application?',
    'Is your VISA one of these subclasses: 651, 601, 186?',
    'Please upload a copy of your most updated resume in PDF or Word format.',
    'What city would you like to work in?',
    'Where did you hear about us?',
    'Which of the following do you have?',
    'What do you have to offer?',
    'First name',
    'Email',
    '手机号码',
    '您是否愿意接受调剂？',
    '',
  ])('%s → nothing', (label) => {
    expect(askedFor(label)).toBeNull();
  });
});
