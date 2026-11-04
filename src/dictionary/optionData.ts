// Bilingual option-label synonyms per enum domain and canonical code. Domains mirror ENUM_VALUES in
// src/schema/fieldKeys.ts (codes must match exactly) plus the extra domains `languageCert` and `pronouns`.
// Entries are compared after normalization (case, punctuation, hyphens and spaces ignored), so
// "CET-6", "CET6" and "cet 6" need no separate entries.

const g = (spec: Record<string, string>): Record<string, string[]> =>
  Object.fromEntries(
    Object.entries(spec).map(([code, v]) => [code, v.split('|').map((x) => x.trim()).filter(Boolean)]),
  );

export const OPTION_SYNONYMS: Record<string, Record<string, string[]>> = {
  gender: g({
    male: '男|男性|男生|Male|Man|M',
    female: '女|女性|女生|Female|Woman|F',
    nonbinary: '非二元|非二元性别|Non-binary|Nonbinary|Gender diverse|Genderqueer|Another term|Self-described',
    undisclosed: '不愿透露|保密|不愿意透露|不想说|不公开|未说明|不便透露|不方便透露|不透露|不想透露|拒绝回答|不愿回答|不愿说明|Prefer not to say|Prefer not to disclose|Not specified|Undisclosed|Rather not say|Decline to answer|Decline to self-identify|Decline to identify|Decline to state|Do not wish to disclose|Prefer not to respond|Prefer not to answer|I don\'t wish to answer|I do not wish to answer',
  }),

  idType: g({
    id_card: '身份证|居民身份证|中华人民共和国居民身份证|二代身份证|ID card|National ID|National ID card|Identity card|Resident identity card|PRC ID',
    passport: '护照|中国护照|Passport',
    hk_macau_permit: '港澳居民来往内地通行证|港澳通行证|回乡证|港澳居民居住证|Hong Kong/Macau permit|HK Macau Travel Permit|Home return permit',
    taiwan_permit: '台湾居民来往大陆通行证|台胞证|台湾通行证|Taiwan permit|Taiwan Compatriot Permit',
    other: '其他|其他证件|其它|Other|Other ID|Other document',
  }),

  maritalStatus: g({
    single: '未婚|单身|Single|Never married|Unmarried',
    married: '已婚|Married',
    divorced: '离异|离婚|已离异|Divorced',
    other: '其他|其它|丧偶|Widowed|Other|Separated|De facto',
  }),

  politicalStatus: g({
    party_member: '中共党员|党员|中国共产党党员|共产党员|正式党员|中国共产党|Party member|CPC member|Communist Party member|Member of the Communist Party of China|CCP member',
    probationary_party_member: '中共预备党员|预备党员|中国共产党预备党员|Probationary party member|Probationary CPC member|Probationary Communist Party member',
    league_member: '共青团员|团员|中国共产主义青年团团员|中国共产主义青年团员|共青团|Communist Youth League member|CYL member|Youth League member|League member',
    masses: '群众|普通群众|无党派群众|Masses|General public|The masses|Non-party member|No party affiliation',
    democratic_party: '民主党派|民主党派成员|民主党派人士|无党派人士|Democratic party member|Member of a democratic party|Democratic party',
    other: '其他|其它|Other|Others',
  }),

  workRightsStatus: g({
    citizen: '澳大利亚公民|澳洲公民|公民|Australian citizen|Australian Citizen|Citizen|Citizen of Australia|Citizenship|Australian citizen or permanent resident|Citizen/PR|Australian citizen/PR|Citizen or PR|Citizen or permanent resident|Australian or New Zealand citizen|Australian Citizen / Permanent Resident',
    permanent_resident: '永久居民|澳洲永久居民|澳大利亚永居|永居|Permanent resident|Australian permanent resident|PR|Permanent residency|Permanent Resident of Australia|Lawful permanent resident|Australian citizen or permanent resident|Citizen/PR|Australian citizen/PR|Citizen or PR|Citizen or permanent resident|Australian Citizen / Permanent Resident',
    graduate_visa: '毕业生签证|485签证|毕业生临时签证|毕业工作签证|Graduate visa|Temporary Graduate visa|Temporary Graduate visa (subclass 485)|Subclass 485|485 visa|Post-study work visa|Temporary visa with full work rights|Temporary resident with full work rights|Temporary visa - full work rights|Visa with full work rights|OPT',
    student_visa: '学生签证|留学生签证|有限工作权利的临时签证|Student visa|Student visa (subclass 500)|Subclass 500|500 visa|Temporary visa with limited work rights|Visa with limited work rights|Limited work rights|International student|Student visa with work restrictions',
    working_holiday: '打工度假签证|打工度假|工作假期签证|Working holiday visa|Working holiday maker|Subclass 417|Subclass 462|WHV|Work and holiday visa',
    other_temporary: '其他临时签证|临时签证|工作签证|其他签证|Other temporary visa|Temporary visa|Temporary resident|Temporary work visa|Skilled work visa|Subclass 482|TSS visa|Employer sponsored visa|Other visa|Visa holder|Bridging visa',
    no_rights: '无工作权利|无工作许可|无工作资格|No work rights|No right to work|Do not have work rights|Not eligible to work|Not authorised to work|Not authorized to work|No work authorisation',
  }),

  employmentType: g({
    full_time: '全职|全职工作|正职|Full-time|Full time|Permanent full-time|Full time permanent|FT',
    part_time: '兼职|非全职|Part-time|Part time|PT',
    internship: '实习|实习生|实习岗位|暑期实习|日常实习|校园实习|Internship|Intern|Summer internship|Vacation program|Vacation placement|Cadetship|Placement',
    contract: '合同工|合同制|外包|劳务派遣|短期合同|项目制|Contract|Contractor|Fixed term|Fixed-term contract|Temporary|Freelance',
    graduate_program: '校招|校园招聘|应届生|应届毕业生|管培生|管理培训生|毕业生项目|培训生|Graduate program|Graduate programme|Graduate|Graduate role|Graduate scheme|Graduate intake|Grad program|Graduate development program|Trainee',
  }),

  degree: g({
    high_school: '高中|高中及以下|中专|高中/中专|普通高中|高中毕业|High school|Secondary school|Year 12|Senior secondary|High school diploma|Secondary education|Year 12 or equivalent',
    associate: '大专|专科|高职|副学士|高职高专|大专/专科|Associate|Associate degree|Diploma|Advanced diploma',
    bachelor: "本科|学士|本科生|学士学位|大学本科|Bachelor|Bachelors|Bachelor's|Bachelor's degree|Bachelor degree|Bachelors degree|Undergraduate|Undergraduate degree|Bachelor (Honours)|Bachelor with honours",
    master: "硕士|硕士研究生|研究生|硕士学位|硕士生|全日制硕士|在读硕士|Master|Masters|Master's|Master's degree|Masters degree|Master degree|Postgraduate|Postgraduate degree|Coursework masters|Masters by research",
    phd: '博士|博士研究生|博士生|博士学位|Doctorate|Doctoral|Doctoral degree|PhD|Ph.D|DPhil|Doctor of Philosophy|Doctorate degree|Doctorate (PhD)',
    other: '其他|其它|其他学历|Other|Others|Other qualification',
  }),

  educationType: g({
    full_time: '全日制|全日制统招|统招全日制|统招|脱产|全日制学习|Full-time|Full time|Full-time study|FT',
    part_time: '非全日制|在职|非全|业余|函授|夜大|自考|成人教育|业余学习|Part-time|Part time|Part-time study|PT',
  }),

  workKind: g({
    internship: '实习|实习经历|实习生|Internship|Intern',
    full_time: '全职|全职工作|正式工作|Full-time|Full time|Employment',
    part_time: '兼职|兼职工作|Part-time|Part time',
  }),

  awardLevel: g({
    national: '国家级|国家|全国|国家级奖励|全国性|国奖|National|National level|Nation-level',
    provincial: '省级|省|省部级|自治区级|Provincial|Province level|State|State level',
    municipal: '市级|地市级|市|Municipal|City|City level|City-level',
    school: '校级|学校|校|School|University|School level|University level|Institutional',
    college: '院级|院系级|学院级|系级|学院|College|Faculty|Department|Faculty level|College level',
    international: '国际级|国际|世界级|International|Global|World|Worldwide|International level',
    other: '其他|其它|其他级别|Other|Others',
  }),

  proficiency: g({
    native: '母语|母语水平|母语者|Native|Native speaker|Native or bilingual|Native/bilingual|Mother tongue|Bilingual',
    fluent: '流利|非常流利|精通|非常熟练|优秀|Fluent|Fluency|Excellent|Very good',
    proficient: '熟练|熟练掌握|熟悉|较好|高级|Proficient|Professional working proficiency|Professional proficiency|Full professional proficiency|Advanced|Competent|Upper intermediate',
    intermediate: '中级|中等|良好|日常交流|日常会话|Intermediate|Conversational|Working proficiency|Limited working proficiency|Good|Moderate',
    basic: '初级|入门|基础|一般|较差|略懂|了解|Basic|Beginner|Elementary|Limited|Novice|Basic proficiency|Fair|A little',
  }),

  relationship: g({
    father: '父亲|爸爸|父|爸|Father|Dad',
    mother: '母亲|妈妈|母|妈|Mother|Mom|Mum',
    spouse: '配偶|丈夫|妻子|夫妻|爱人|老公|老婆|Spouse|Husband|Wife|Partner|Spouse/Partner|De facto partner',
    sibling: '兄弟姐妹|兄弟|姐妹|哥哥|姐姐|弟弟|妹妹|兄|姐|Sibling|Brother|Sister',
    other: '其他|其它|亲属|朋友|Other|Friend|Relative|Other relative|Guardian',
  }),

  diversity: g({
    yes: '是|有|Yes|Yes, Aboriginal|Yes, Torres Strait Islander|Yes, Aboriginal and Torres Strait Islander|Yes, both|Yes, I am|Yes, I do|Yes, I have a disability|Yes, I identify|Yes, I have',
    no: '否|无|没有|No|None|No, neither|Neither|No, I am not|No, I do not|No, I don\'t have a disability|I am not|No, I am not Aboriginal or Torres Strait Islander|Not Aboriginal or Torres Strait Islander',
    prefer_not_to_say: '不愿透露|不愿回答|不想回答|拒绝回答|不便透露|Prefer not to say|Prefer not to answer|I don\'t wish to answer|I do not wish to answer|Decline to answer|Decline to state|Choose not to disclose|Prefer not to disclose|Not disclosed|Rather not say|I prefer not to say|Prefer not to respond',
  }),

  yesNo: g({
    yes: '是|是的|有|Yes|Y|True|接受|愿意|服从|同意|Yes, I do|Yes, I am|Yes, I will|Yes I do|Yes I am',
    no: '否|不是|无|没有|No|N|False|不接受|不愿意|不服从|不同意|No, I do not|No, I don\'t|No, I am not|No I do not|No I am not',
  }),

  salaryCurrency: g({
    CNY: '人民币|RMB|CNY|CN¥|元|人民币元|¥|Chinese Yuan|Renminbi|Yuan|CNY - Chinese Yuan|CNY - Renminbi|RMB - Chinese Yuan',
    AUD: 'AUD|A$|AU$|澳元|澳币|Australian Dollar|Australian Dollars|AUD - Australian Dollar',
    USD: 'USD|US$|美元|美金|US Dollar|American Dollar|United States Dollar|USD - US Dollar',
  }),

  salaryPeriod: g({
    month: '月|月薪|每月|每月薪资|按月|月度|元/月|/月|Month|Monthly|Per month|A month|/month|Per mo',
    year: '年|年薪|每年|按年|年度|元/年|/年|Year|Yearly|Annual|Annually|Per year|Per annum|p.a.|PA|Annum|/year',
  }),

  // ---- extra domains (not in ENUM_VALUES)
  languageCert: g({
    cet4: 'CET-4|CET4|CET 4|英语四级|大学英语四级|四级|大学英语四级考试|全国大学英语四级|College English Test Band 4|CET-4 (College English Test Band 4)',
    cet6: 'CET-6|CET6|CET 6|英语六级|大学英语六级|六级|大学英语六级考试|全国大学英语六级|College English Test Band 6|CET-6 (College English Test Band 6)',
    tem4: 'TEM-4|TEM4|专四|英语专业四级|英语专业四级考试|Test for English Majors Band 4',
    tem8: 'TEM-8|TEM8|专八|英语专业八级|英语专业八级考试|Test for English Majors Band 8',
    ielts: '雅思|雅思考试|IELTS|IELTS Academic|International English Language Testing System|IELTS General Training',
    toefl: '托福|托福考试|TOEFL|TOEFL iBT|TOEFL ITP|Test of English as a Foreign Language',
    pte: 'PTE|PTE Academic|Pearson Test of English|Pearson English test|培生英语|培生英语测试',
    duolingo: '多邻国|多邻国英语测试|Duolingo|Duolingo English Test|DET',
    jlpt_n1: '日语N1|日语一级|JLPT N1|N1',
    jlpt_n2: '日语N2|日语二级|JLPT N2|N2',
    jlpt_n3: '日语N3|日语三级|JLPT N3|N3',
    none: '无|未考|没有|暂无|None|No certificate|Not taken|N/A',
    other: '其他|其它|Other|Others',
  }),

  genderAnswer: g({
    prefer_not_to_say: '不愿透露|Prefer not to say',
    from_resume: '按简历填写|Answer from my resume',
  }),

  pronouns: g({
    he_him: 'He/him|He/him/his|He, him|He/Him/His',
    she_her: 'She/her|She/her/hers|She, her|She/Her/Hers',
    they_them: 'They/them|They/them/theirs|They, them|They/Them/Theirs',
    prefer_not_to_say: 'Prefer not to say|Prefer not to disclose|Not specified|不愿透露',
  }),
};
