// Hand-written zh/en label synonyms for the single-instance modules (basics, contact, work rights,
// job intention, diversity, free-text modules, attachments). Array modules live in fieldDataModules.ts.
//
// Conventions
// - Entries are matched after `normalizeLabel`, so punctuation/asterisks/"请输入" need not be listed.
// - zh/en are split by "|" for compactness; the arrays are built by `s()`.
// - `exclude` words veto the whole key when the label contains them (prefix match for latin words).
// - Synonyms of ≤ 1 CJK char or ≤ 2 latin chars are exact-only (see isExactOnlySynonym in fields.ts).

export interface FieldSynonym {
  zh: string[];
  en: string[];
  /** Words that veto this key when present in the label (e.g. "家庭" for basics.familyName). */
  exclude?: string[];
  /** Words of which the label must have one, or the key is vetoed: "citizen or permanent resident" is not "citizen". */
  require?: string[];
}

export const s = (zh: string, en: string, exclude = '', require = ''): FieldSynonym => {
  const split = (v: string) => v.split('|').map((x) => x.trim()).filter(Boolean);
  const out: FieldSynonym = { zh: split(zh), en: split(en) };
  if (exclude) out.exclude = split(exclude);
  if (require) out.require = split(require);
  return out;
};

/** Labels that belong to an organisation/other entity rather than a person's own name. */
/** Words that make a name, phone or email someone else's, among the applicant's own questions. */
const OTHER_PEOPLE = '父亲|母亲|配偶|导师|领导|上级|家长|监护人|亲属|家属|联系人|hr姓名|hr电话|hr手机|hr邮箱|father|mother|spouse|guardian|parent|supervisor';
const NOT_PERSON = `${OTHER_PEOPLE}|` + '公司|单位|学校|院校|项目|奖|证书|组织|社团|推荐人|证明人|紧急|联系人|家庭|家属|亲属|company|employer|school|university|institution|project|award|certificate|organi|referee|emergency|contact|family member|file name|user name|username';
/** Region-ish qualifiers that make a plain "city / province / country" label something else. */
const OTHER_PLACE = '籍贯|户口|户籍|生源|出生|学校|院校|公司|单位|期望|意向|工作|birth|school|university|company|employer|work|preferred|desired|expected';

export const PERSONAL_FIELD_SYNONYMS: Record<string, FieldSynonym> = {
  // ------------------------------------------------------------ basics
  'basics.fullName': s(
    '姓名|全名|真实姓名|中文姓名|姓名中文|姓名全称|您的姓名|申请人姓名|应聘者姓名|求职者姓名|本人姓名',
    'Full name|Name|Your name|Your full name|Legal name|Full legal name|Applicant name|Candidate name|Name as per ID',
    `姓氏|英文|昵称|名字拼音|课程|first|last|middle|given|family|surname|preferred|nick|english|${NOT_PERSON}`,
  ),
  'basics.familyName': s(
    '姓|姓氏|中文姓|中文姓氏',
    'Last name|Surname|Family name|Lastname|Last name/surname|Family name/surname',
    '家庭|家人|家属|family member|family background|family info|family detail|family contact',
  ),
  'basics.givenName': s(
    '名|名字|中文名|名(中文)',
    'First name|Given name|Given names|Given name(s)|Forename|Firstname|First/given name|Legal first name',
    '昵称|公司|学校|项目|nick|company|school|project',
  ),
  'basics.preferredName': s(
    '常用名|昵称|称呼|希望的称呼|惯用名',
    'Preferred name|Preferred first name|Nickname|Known as|What should we call you|Preferred name (if different)',
    '曾用',
  ),
  'basics.englishName': s(
    '英文名|英文姓名|英文名字|拼音姓名|姓名拼音|拼音',
    'English name|Name in English|Pinyin name|Western name|English first name',
    '学校|院校|公司|单位|school|university|company|employer',
  ),
  'basics.pronouns': s(
    '代词|人称代词|性别代词|称谓代词',
    'Pronouns|Preferred pronouns|Your pronouns|Personal pronouns|Gender pronouns',
  ),
  'basics.gender': s(
    '性别|您的性别|性别(男/女)|性别男女',
    'Gender|Sex|Your gender|Gender (male/female)|Legal sex',
    '认同|identity|identify|orientation|pronoun',
  ),
  'basics.birthDate': s(
    '出生日期|出生日期(年龄)|出生年月|出生年月日|生日|出生时间|出生日|出生年份',
    'Date of birth|DOB|Birth date|Birthdate|Birthday|D.O.B|Date of birth (dd/mm/yyyy)',
  ),
  'basics.nationality': s(
    '国籍|国籍/地区|国籍地区|所属国籍|公民身份国家',
    'Nationality|Citizenship|Country of citizenship|Citizen of|Country of nationality',
    '状态|身份类型|签证|居留|status|residency|visa|permanent|work rights',
  ),
  'basics.ethnicity': s(
    '民族|族别|民族名称|所属民族',
    'Ethnicity|Ethnic group|Ethnic background|Race|Race/ethnicity|Ethnic origin',
    'indigenous|aboriginal|torres|原住民',
  ),
  'basics.idType': s(
    '证件类型|身份证件类型|证件种类|有效证件类型|身份类型',
    'ID type|Identification type|Document type|ID document type|Type of identification|Identity document type',
  ),
  'basics.idNumber': s(
    '证件号码|证件号|身份证号|身份证号码|证件编号|护照号|护照号码|有效证件号码',
    'ID number|Identity number|Identification number|Passport number|Passport no|ID no|Document number',
    '学号|工号|student|employee|tax file|certificate|visa|发票',
  ),
  'basics.maritalStatus': s(
    '婚姻状况|婚否|婚姻|婚姻情况|是否已婚',
    'Marital status|Relationship status|Marital|Are you married',
  ),
  'basics.politicalStatus': s(
    '政治面貌|党派|政治身份|政治状态|政治面貌(党派)|政治面貌党派',
    'Political status|Political affiliation|Party affiliation|Political party|Party membership',
  ),
  'basics.partyJoinDate': s(
    '入党时间|入党日期|入党团时间|加入党派时间|入团时间|入党年月|入党(团)时间',
    'Party join date|Date joined party|Date of joining the party|Party membership date|Party admission date',
  ),
  'basics.height': s(
    '身高|身高(cm)|身高厘米|您的身高',
    'Height|Height (cm)|Your height|Body height',
  ),
  'basics.weight': s(
    '体重|体重(kg)|体重公斤|您的体重',
    'Weight|Weight (kg)|Your weight|Body weight',
  ),
  'basics.nativePlace': s(
    '籍贯|祖籍|原籍|出生地|籍贯所在地|出生地点|出生地(省市)|家乡|老家',
    'Native place|Hometown|Place of birth|Birthplace|Country of birth|Place of origin|Town of birth',
  ),
  'basics.studentOrigin': s(
    '生源地|生源所在地|生源省份|生源地区|考生所在地|高考所在地|入学前户籍所在地',
    'Student origin|Student source location|Origin of student|Place of origin before enrollment|Place of origin before enrolment',
  ),
  'basics.household': s(
    '户口所在地|户籍所在地|户籍地|户口|户籍|户口地|户口所在地(省市)',
    'Household registration|Hukou|Hukou location|Registered residence|Household registration location|Hukou registration place',
  ),
  'basics.currentLocation': s(
    '现居住地|现居地|居住地|当前所在地|目前所在地|现所在地|所在地|居住城市|现居城市|现居住城市|所在地点|当前所在地点|目前所在地点|现所在地点',
    'Location|Your location|Current location|Current city|Location (City)|Location City|Where are you based|Where are you located|Where are you currently located|Where are you currently based|Current residence|City of residence|Place of residence',
    '期望|意向|工作|学校|院校|公司|单位|preferred|desired|expected|school|company|employer|work',
  ),
  'basics.age': s(
    '年龄|岁数|周岁|实际年龄|您的年龄',
    'Age|Your age|Age (years)|Current age|Age in years',
  ),
  'education.fullTimeStudent': s(
    '是否为全日制在校学生|是否全日制在校学生|是否为全日制在校生|是否全日制在校生|是否为在校全日制学生|是否全日制在读',
    'Are you a full-time student|Are you currently a full-time student|Currently enrolled full-time',
  ),
  'basics.isAdult': s(
    '是否年满18周岁|是否已满18周岁|是否年满18岁|是否已满18岁|是否年满十八周岁|年满18周岁|是否成年|是否已成年',
    'Are you over 18|Are you over 18 years|Are you over 18 years old|Are you 18 or over|Are you 18 or older|Are you 18 years or older|Are you 18 years of age or older|Are you at least 18|Are you at least 18 years of age|Are you at least 18 years old|Are you over the age of 18|Over 18|18 years or older|18 or over',
  ),

  // ------------------------------------------------------------ contact
  'contact.email': s(
    '邮箱|电子邮箱|电子邮件|邮件|常用邮箱|个人邮箱|确认邮箱|再次输入邮箱|邮箱确认|邮箱地址|电子邮件地址',
    'Email|E-mail|Email address|Confirm email|Confirm email address|Re-enter email|Retype email|Personal email|Email (confirm)',
    `推荐人|证明人|验证|紧急|referee|reference|verif|emergency|code|${OTHER_PEOPLE}`,
  ),
  'contact.phoneCountryCode': s(
    '国家区号|区号|国家代码|手机区号|国际区号|国家/地区代码|电话区号|国家码',
    'Country code|Phone country code|Territory phone code|Dialing code|Dialling code|Calling code|Country calling code|Mobile country code|International dialing code',
    '邮编|邮政|邮递|post|zip',
  ),
  'contact.phone': s(
    '联系方式|手机|手机号|手机号码|联系电话|电话|联系手机|移动电话|电话号码|常用电话|联系电话(手机)|本人手机',
    'Phone|Phone number|Mobile|Mobile number|Mobile phone|Contact number|Telephone|Cell phone|Contact phone|Contact phone number|Mobile/phone',
    `备用|紧急|应急|家庭|推荐人|证明人|区号|验证|emergency|referee|reference|country code|verif|code|family|next of kin|${OTHER_PEOPLE}`,
  ),
  'contact.phoneFull': s(
    '手机号(含区号)|手机号含区号|国际电话|电话(含国家代码)|电话含国家代码|含区号手机号|带区号手机号',
    'Phone with country code|International phone number|Full phone number|Mobile (with country code)|Phone (including country code)|Mobile number with country code',
  ),
  'contact.wechat': s(
    '微信|微信号|微信账号|微信ID|微信号码',
    'WeChat|WeChat ID|WeChat account|Weixin|WeChat number',
  ),
  'contact.qq': s(
    'QQ|QQ号|QQ号码|QQ账号|QQ账号/号码',
    'QQ number|QQ ID|QQ account|Tencent QQ',
  ),
  'contact.inNamedCountry': s('是否位于该国家|是否身在该国', 'Located in the named country|In the named country'),
  'contact.addressCountry': s(
    '国家|国家/地区|所在国家|居住国家|所在国家/地区|居住国家/地区',
    'Country|Country/Region|Country of residence|Residential country|Country or region|Country/territory',
    '国籍|出生|区号|学校|院校|签发|nationality|citizenship|birth|code|school|university|issue|study|institution',
  ),
  'contact.addressProvince': s(
    '省|省份|省/直辖市|所在省份|省/自治区/直辖市|省市|所在省',
    'State|State/Territory|State/Province|Province|State or territory|State/Province/Region|County/State',
    OTHER_PLACE,
  ),
  'contact.addressCity': s(
    '城市|所在城市|市|所在市|地级市|居住城市|市/区',
    'City|Suburb|Town|City/Suburb|Suburb/Town|City/Town|Locality|Suburb or town',
    OTHER_PLACE,
  ),
  'contact.addressDistrict': s(
    '区|区县|区/县|所在区县|区域|县|所在区',
    'District|County|Local government area|LGA|Borough|Region|Area',
    OTHER_PLACE,
  ),
  'contact.addressStreet': s(
    '街道|街道地址|详细地址|详细住址|门牌号|街道门牌号|地址第一行',
    'Street|Street address|Address line 1|Address line|Address 1|Street name and number|Residential street address|Address line one',
    'email|邮箱|邮件|company|公司|单位|work',
  ),
  'contact.postcode': s(
    '邮编|邮政编码|邮政编号|邮码|邮递区号',
    'Postcode|Post code|Postal code|ZIP|ZIP code|Zip/Postal code|ZIP/Postcode',
  ),
  'contact.addressFull': s(
    '通讯地址|联系地址|家庭住址|家庭地址|现住址|现居住地址|住址|居住地址|邮寄地址|通信地址|详细通讯地址',
    'Address|Mailing address|Postal address|Residential address|Home address|Current address|Full address|Contact address|Address (full)',
    'email|e-mail|web|ip|company|work|office|billing|邮箱|邮件|公司|单位|工作|学校|籍贯|户口|户籍|院校',
  ),
  'contact.linkedin': s(
    '领英|领英主页|领英链接|领英账号',
    'LinkedIn|LinkedIn URL|LinkedIn profile|LinkedIn profile URL|LinkedIn link|LinkedIn account',
  ),
  'contact.github': s(
    'GitHub主页|GitHub链接|GitHub地址|GitHub账号|代码仓库主页',
    'GitHub|GitHub URL|GitHub profile|GitHub link|GitHub username|GitHub account',
  ),
  'contact.portfolio': s(
    '作品集|作品集链接|作品集网址|个人作品|作品链接|作品展示',
    'Portfolio|Portfolio URL|Portfolio link|Online portfolio|Portfolio website|Behance|Dribbble',
    'github|linkedin|附件|upload|文件',
  ),
  'contact.website': s(
    '个人网站|个人主页|个人博客|博客|主页|网站|个人网址',
    'Website|Personal website|Website URL|Personal site|Blog|Other URL|Other links|Personal blog',
    'linkedin|github|portfolio|公司|company|作品集|学校',
  ),

  // ------------------------------------------------------------ work rights
  'workRights.status': s(
    '工作权利|工作许可|工作资格|签证状态|工作身份|在澳工作权利|工作签证状态|居留状态|身份状态',
    'Work rights|Work rights status|Work authorisation|Work authorization|Visa status|Working rights|Citizenship status|Residency status|Immigration status|Visa/work rights|Current work rights|Work rights in Australia|Work rights in your country|What are your working rights in Australia|What are your work rights in Australia|Working rights in Australia|What are your working rights|What are your work rights',
    // Yes/no questions about the status go to their own keys; "What are your working rights" still asks for it.
    '担保|赞助|需要|是否有|是否为|sponsor|do you have|full work|are you a|are you legally|are you eligible|are you currently|are you permitted|require',
  ),
  'workRights.visaType': s(
    '签证类型|签证种类|签证类别|签证子类|持有签证类型',
    'Visa type|Visa subclass|Type of visa|Visa class|Visa category|Visa subclass number',
  ),
  'workRights.visaExpiry': s(
    '签证到期|签证到期日|签证有效期|签证有效期至|签证过期时间|签证到期时间',
    'Visa expiry date|Visa expiry|Visa expiration|Visa expires|Date visa expires|Work rights expiry|Visa expiration date',
  ),
  'workRights.requiresSponsorship': s(
    '是否需要签证担保|是否需要担保|是否需要雇主担保|需要担保|签证担保|工作签证担保|是否需要工作签证担保',
    'Require sponsorship|Do you require sponsorship|Sponsorship required|Visa sponsorship|Require visa sponsorship|Need sponsorship|Employer sponsorship|Will you now or in the future require sponsorship',
    // 是否需要提前实习 asks when someone can start, not about a visa.
    '实习|入职|到岗',
  ),
  'workRights.citizenOrResident': s(
    '是否为澳大利亚公民或永久居民|是否为公民或永久居民|是否为公民或永久居民身份|公民或永久居民',
    'Are you an Australian citizen or permanent resident|Are you an Australian Citizen, Permanent Resident or a New Zealand Citizen|Are you an Australian citizen, permanent resident or New Zealand citizen|Are you a citizen or permanent resident|Australian citizen or permanent resident|Australian citizen, permanent resident or New Zealand citizen|Citizen or permanent resident',
    '',
    'permanent resident|permanent residency|permanent residence|永久居民|永久居留|永居',
  ),
  'workRights.citizen': s(
    '是否为澳大利亚公民|是否澳大利亚公民|是否为澳洲公民|是否拥有澳大利亚国籍|是否为本国公民',
    'Are you an Australian citizen|Australian citizen|Do you hold Australian citizenship|Are you a citizen of Australia|Australian citizenship',
    // Permanent residents are asked about too in those questions, and another country's citizenship is not this one.
    'permanent|resident|永久|居民|new zealand|新西兰|nz citizen|status|状态',
  ),
  'workRights.hasFullWorkRights': s(
    '是否拥有完整工作权利|是否有工作权利|是否有合法工作资格|是否可以合法工作|完整工作权利|是否有完整工作权利|是否有权在澳工作',
    'Full work rights|Full legal working rights|Current work rights in this country|Current work rights in Australia|Do you have full work rights|Do you have the right to work|Right to work in Australia|Legally authorised to work|Legally authorized to work|Unrestricted work rights|Eligible to work|Authorised to work|Authorized to work',
  ),

  // ------------------------------------------------------------ job intention
  'jobIntention.positions': s(
    '应聘职位|申请职位|应聘岗位|意向岗位|期望职位|期望岗位|求职意向|意向职位|报考职位|志愿岗位|第一志愿',
    'Position applied for|Role applying for|Position of interest|Desired position|Desired role|Job applied for|Preferred role|Role preference|Job preference|Applying for',
  ),
  'jobIntention.cities': s(
    '期望工作地点|意向城市|期望城市|意向工作地|期望工作城市|工作地点意向|意向工作城市|志愿城市',
    'Preferred location|Preferred work location|Preferred city|Location preference|Desired location|Work location preference|Preferred office location|Which office',
  ),
  'jobIntention.industry': s(
    '期望行业|意向行业|行业|所属行业|从事行业|意向行业类别',
    'Industry|Preferred industry|Desired industry|Industry of interest|Sector|Preferred sector',
    '公司|单位|company|employer',
  ),
  'jobIntention.employmentType': s(
    '工作性质|求职类型|职位类型|工作类型|期望工作性质|雇佣类型|用工类型|应聘类型|招聘类型|岗位类型',
    'Employment type|Job type|Work type|Type of employment|Position type|Role type|Contract type|Employment status sought',
  ),
  'jobIntention.salaryMin': s(
    '最低薪资|最低期望薪资|期望薪资下限|薪资下限|最低月薪|期望薪资|期望月薪|薪资期望|期望年薪',
    'Minimum salary|Min salary|Salary from|Salary range from|Expected salary|Minimum expected salary|Lowest salary|Salary expectation|Salary expectations|Desired salary',
    '最高|上限|maximum|max|highest|upper',
  ),
  'jobIntention.salaryMax': s(
    '最高薪资|薪资上限|期望薪资上限|最高月薪|最高期望薪资|薪资最高',
    'Salary expectations|Maximum salary|Max salary|Salary to|Salary range to|Maximum expected salary|Highest salary|Upper salary',
  ),
  'jobIntention.salaryCurrency': s(
    '币种|货币|薪资币种|货币类型|薪资货币',
    'Currency|Salary currency|Currency type|Pay currency',
  ),
  'jobIntention.salaryPeriod': s(
    '薪资周期|薪资单位|计薪周期|薪资类型|薪资方式|计薪方式',
    'Salary period|Pay period|Salary frequency|Pay frequency|Salary basis|Salary type|Rate type',
  ),
  'jobIntention.availableFrom': s(
    '可实习时间|到岗时间|最快到岗时间|可到岗时间|期望到岗时间|可入职时间|预计入职时间|最早入职时间|期望入职时间|最早到岗日期',
    'Earliest start date|Available from|Availability date|Available start date|Date available|When can you start|Available to start|Earliest availability|Commencement date|Preferred start date|Availability|Earliest availability to start|Your earliest availability to start employment|Earliest availability to start employment|When could you start|Earliest date you could start',
    '毕业|学校|每周|每月|每天|天数|时长|多久|面试|电话|视频|graduat|school|education|per week|hours|interview|call|video|chat|meeting',
  ),
  'jobIntention.noticePeriod': s(
    '通知期|离职通知期|离职交接期|到岗通知期|需提前通知时间|提前通知期|离职通知时间',
    'Notice period|Notice required|Current notice period|Length of notice|Period of notice|How much notice|How much notice do you need to give|Notice',
  ),
  'jobIntention.acceptAdjustment': s(
    '是否服从调剂|是否接受调剂|是否同意调剂|是否服从分配|服从调剂|接受调剂|是否服从岗位调剂|是否服从调配|是否愿意调剂|是否愿意服从公司分配|是否服从公司分配|服从公司分配|是否愿意服从分配|是否接收组织调配|是否接受组织调配|是否服从组织调配|服从组织调配|接受组织调配',
    'Accept adjustment|Willing to be reassigned|Open to other roles|Open to alternative positions|Consider other roles|Would you consider other positions|Open to similar roles|Willing to accept alternative positions',
  ),
  'jobIntention.acceptRelocation': s(
    '是否接受外派|是否接受异地工作|是否服从工作地点调配|是否愿意外派|是否接受外地工作|是否愿意异地就业|是否接受调动|是否愿意到外地工作|外派',
    'Relocate|Willing to relocate|Are you willing to relocate|Open to relocation|Relocation|Willing to move|Able to relocate|Open to relocating|Willing to work in other locations',
  ),
  'jobIntention.howDidYouHear': s(
    '信息来源|招聘渠道|渠道来源|您从哪里了解到我们|您是如何得知本次招聘的|如何得知招聘信息|获知渠道|了解渠道|招聘信息来源|应聘渠道',
    'How did you hear about us|How did you hear about this role|How did you hear about this position|How did you hear about this job|Where did you hear about us|How did you find out about this job|Referral source|How did you learn about us|Application source|Where did you find this job|How did you find us',
  ),

  // ------------------------------------------------------------ application questions
  'questions.canTravel': s(
    '能否出差|是否接受出差|是否能接受出差|能否接受出差|是否愿意出差|能否适应出差|是否能出差|是否接受短期出差|能否接受经常出差|出差',
    'Willing to travel|Are you willing to travel|Able to travel|Are you able to travel|Open to travel|Willing to travel for work|Travel required|Can you travel|Are you willing to travel for work',
    '补贴|费用|报销|住宿|allowance|expense|insurance|time|distance|commute',
  ),
  'questions.shiftWork': s(
    '是否接受轮班|能否接受轮班|是否接受倒班|能否接受倒班|能否倒班|是否接受夜班|是否接受周末上班|能否接受周末工作|是否能接受排班',
    'Shift work|Are you able to work shifts|Are you available to work shifts|Willing to work shifts|Able to work weekends|Are you available to work weekends|Rotating shifts|Night shifts|Roster',
  ),
  'questions.overtime': s(
    '是否接受加班|能否接受加班|是否能接受加班|是否愿意加班|能否适应加班',
    'Willing to work overtime|Are you willing to work overtime|Able to work overtime|Overtime|Extra hours|Are you able to work additional hours',
  ),
  'questions.canWorkOnsite': s(
    '是否可以到岗办公|能否到公司办公|是否接受现场办公|能否线下办公|是否能到办公室工作|是否接受驻场',
    'Can you work on-site|Are you able to work on-site|Able to work on site|Can you work onsite|Can you work from the office|Are you able to work in the office|Willing to work on-site|On-site availability',
  ),
  'questions.workArrangement': s(
    '工作方式|办公方式|期望办公方式|期望工作方式|远程办公|线上或线下',
    'Work arrangement|Preferred work arrangement|Work arrangements|Working arrangement|Work model|Preferred work model|Remote or hybrid|On-site, hybrid or remote|Workplace type|Working style',
  ),
  'questions.earlyInternship': s(
    '是否需要/可以提前实习|是否可以提前实习|能否提前实习|是否可提前实习|是否接受提前实习|是否愿意提前实习|提前实习',
    'Can you start your internship early|Available to start the internship early|Early internship|Able to intern before graduation|Can you start an internship before the program begins',
  ),
  'questions.internshipDaysPerWeek': s(
    '每周可实习天数|每周实习天数|每周实习时间|每周能实习几天|每周可到岗天数|每周出勤天数|一周可实习几天|每周实习',
    'Days per week|How many days per week can you intern|Days available per week|Internship days per week|How many days a week can you work|Days per week available|Weekly availability (days)',
  ),
  'questions.internshipMonths': s(
    '可实习时长|实习时长|实习周期|可实习多久|可实习几个月|实习期限|可持续实习时间|实习持续时间',
    'Internship duration|How long can you intern|Length of internship|Internship length|How many months can you intern|Duration of internship|Available internship period',
  ),
  'questions.offerCount': s(
    '已获得几份其他公司offer|已获得几份offer|目前已有几个offer|手头offer数量|已有offer数量|已拿到offer数量|已获offer数|获得的offer数量|已获得offer数量',
    'How many job offers do you currently hold|How many offers do you currently hold|Number of offers|Number of job offers|Offers in hand|How many offers do you have|Current number of offers',
    '薪资|薪酬|待遇|salary|pay|compensation',
  ),
  'questions.offerSalaryRange': s(
    '已获得offer薪资范围|offer薪资范围|已有offer薪资|已获offer薪资|手头offer薪资|已获得offer的薪资|offer薪酬',
    'Salary of offers in hand|Offer salary range|Salary range of current offers|What salary are your current offers|Offered salary',
  ),
  'questions.currentSalary': s(
    '目前薪资|当前薪资|当前年薪|目前年薪|目前月薪|当前月薪|现薪资|现在薪资|目前薪酬|当前薪酬',
    'Current salary|What is your current salary|Current pay|Current base salary|Current compensation|Current remuneration|Current package|Present salary|Current annual salary',
    '期望|expected|desired|expectation',
  ),
  'questions.relativesAtCompany': s(
    '是否有亲友在本公司就职|是否有亲友就职|是否有亲属在本公司工作|是否有亲友在我司|有无亲友在本公司|是否有亲属在公司任职|是否有亲友在公司工作|亲友是否在本公司',
    'Do you have any relatives or friends working at the company|Do you have relatives working here|Do you have family members employed by us|Relatives working at the company|Do you know anyone who works here|Any family or friends employed here|Do you have a personal relationship with an employee',
    '姓名|关系|说明|name|relationship|details|explain',
  ),
  'questions.relativesDetail': s(
    '亲友姓名及关系|亲属姓名及关系|亲友姓名|亲友关系说明|在职亲友姓名|亲友所在部门|如有亲友请说明',
    'Name and relationship of relatives working here|If yes, please provide their name and relationship|Relative name and relationship|Details of relatives employed here|Name of family member employed here',
  ),
  'questions.workedHereBefore': s(
    '是否曾在本公司工作|是否在我司工作过|是否曾在本公司任职|是否曾就职于本公司|曾在本公司工作|是否为前员工|是否曾在我司实习|是否曾在本集团工作',
    'Have you previously worked for this company|Have you previously worked for us|Have you worked for us before|Have you worked for us|Have you worked here before|Have you been employed here before|Previously employed by us|Former employee|Are you a former employee|Have you ever worked for|Have you previously worked for or are you currently working for|previously worked for or are you currently working for',
  ),
  'questions.referrerName': s(
    '内推人姓名|内推人|内推员工姓名|内推员工|推荐员工姓名|内部推荐人',
    'Who referred you|Who referred you to this role|Referrer|Referrer name|Referred by|Name of the person who referred you|Employee referral name|Name of referring employee|If you were referred to this role',
    // A staff number or a code is not the name.
    '工号|编号|号码|推荐码|内推码|id|number|code',
  ),
  'questions.campusAmbassador': s(
    '是否愿意成为校园大使|是否愿意担任校园大使|校园大使|是否愿意成为校园推广大使|是否愿意担任校园推广人',
    'Campus ambassador|Would you like to be a campus ambassador|Student ambassador|Interested in becoming a campus ambassador|University ambassador',
  ),
  'questions.graduateStatus': s(
    '应届/往届|应届往届|应届或往届|毕业生类型|应往届|届别类型|应届/非应届',
    'Graduate status|New or past graduate|Recent graduate status|Graduate type|Are you a new graduate',
  ),
  'questions.furtherStudyPlan': s(
    '是否计划升学深造或考公/考编|是否计划升学深造或考公|是否计划升学|是否有考研计划|是否考公考编|是否计划读研|是否有深造计划|是否计划出国深造',
    'Do you plan further study|Plans for further study|Are you planning postgraduate study|Do you intend to pursue further education|Planning to continue studies',
  ),
  'questions.securityClearance': s(
    '安全审查级别|安全许可级别|安全审查|保密资格',
    'Security clearance|What level of security clearance do you currently hold|Current security clearance|Clearance level|Do you hold a security clearance|AGSVA clearance|Highest security clearance held',
  ),
  'questions.driversLicence': s(
    '是否持有驾驶证|是否有驾照|驾照|驾驶证|是否有驾驶证|有无驾照|驾照类型|是否持有驾照',
    "Driver's licence|Driver's license|Drivers licence|Do you hold a current driver's licence|Do you have a driver's license|Current driver licence|Valid driver's licence|Full driving licence",
    '号码|编号|有效期|number|expiry|class',
  ),
  'questions.englishWorkingLanguage': s(
    '英语是否可作为工作语言|英语能否作为工作语言|能否使用英语工作|是否能用英语工作|英文可否作为工作语言|是否可用英语办公',
    'English as a working language|Can you use English as your working language|Are you comfortable using English as your working language|Can you work in English|Is English your working language',
  ),
  'questions.yearsExperience': s(
    '工作年限|工作年数|工作经验年限|相关工作年限|从业年限|累计工作年限',
    'Years of experience|How many years of professional experience do you have|Years of professional experience|Total years of experience|Years of work experience|Years of relevant experience|How many years of experience do you have',
    // Years in one trade or field: the resume counts years worked, not years in an industry.
    '团队|带队|管理|行业|领域|leading|lead|managing|manage|management|supervis|experience in|years in|do you have in|industry',
  ),
  'questions.yearsLeading': s(
    '带团队年限|带团队年数|管理团队年限|团队管理年限|管理经验年限|带团队经验|管理岗位年限',
    'Years leading teams|How many years of experience do you have leading teams|Years of people management|Years managing teams|Years of leadership experience|How many years have you managed people',
  ),
  'questions.background': s(
    '背景描述|您的背景|个人背景|专业背景描述|最符合您的背景|以下哪项最符合您的背景',
    'Which best describes your background|Background|Your background|Professional background|Which of the following best describes you|Describe your background',
  ),

  // ------------------------------------------------------------ diversity
  'diversity.indigenous': s(
    '原住民|澳洲原住民|原住民身份|是否原住民|原住民或托雷斯海峡岛民',
    'Aboriginal or Torres Strait Islander|Aboriginal and/or Torres Strait Islander|Are you of Aboriginal or Torres Strait Islander origin|Indigenous|Indigenous status|Indigenous Australian|First Nations|First Nations status|Aboriginal|Torres Strait Islander',
  ),
  'diversity.disability': s(
    '残疾|残障|是否残疾|残疾状况|是否有残疾|残疾情况|残疾人',
    'Disability|Do you have a disability|Do you identify as a person with disability|Person with disability|Disability status|Disability or long-term health condition|Long-term health condition',
  ),
  'diversity.genderIdentity': s(
    '性别认同|性别身份|性取向|性少数|性别多元',
    'Gender identity|LGBTIQ|LGBTQ|LGBTQIA+|Sexual orientation|Gender diversity|Do you identify as LGBTIQ+|LGBT',
  ),
  'diversity.veteran': s(
    '退伍军人|是否退伍军人|是否退役军人|退役军人|军人身份|服役经历',
    'Veteran|Veteran status|Are you a veteran|Military service|Armed forces|Protected veteran|Defence force|Have you served in the Australian Defence Force',
  ),

  // ------------------------------------------------------------ free text + files
  'misc.selfIntroduction': s(
    '自我评价|自我介绍|个人简介|个人介绍|自我描述|个人总结|个人陈述|个人特点|个人评价',
    'Tell us about yourself|About you|About me|Introduce yourself|Personal statement|Professional summary|Personal summary|Bio|Short bio|Describe yourself|Self introduction|Self-introduction|Self assessment',
  ),
  // Long-text answers: drafted from the resume, shown in the side panel, written only when the applicant says so.
  'answers.coverLetter': s(
    '求职信|自荐信|求职信内容|附信|致招聘方的信|求职自荐信',
    'Cover letter|Covering letter|Cover note|Letter of application|Motivation letter|Motivational letter|Letter of motivation',
    '上传|附件|upload|attach|file',
  ),
  'answers.whyUs': s(
    '为什么选择我们|为什么选择本公司|为什么想加入我们|为什么加入我们|为何选择我们|为什么选择我司|为什么应聘该岗位|为什么申请这个职位|你为什么想加入|选择我们的理由|应聘动机|求职动机|申请动机|加入我们的原因',
    'Why do you want to work for us|Why do you want to work here|Why do you want to join us|Why are you interested in this role|Why are you interested in this position|Why this role|Why us|Why do you want this job|Why are you applying|What attracted you to this role|What interests you about this role|Motivation for applying',
  ),
  'answers.strengths': s(
    '个人优势|你的优势|我的优势|核心优势|主要优势|个人亮点|优势特长|你的长处|个人长处|你有哪些优势',
    'What are your key strengths|What are your strengths|Key strengths|Your strengths|Strengths|Main strengths|What makes you a strong candidate|What sets you apart|Why should we hire you',
    '劣势|缺点|不足|weakness|weaknesses',
  ),
  'answers.careerPlan': s(
    '职业规划|职业发展规划|个人职业规划|未来规划|职业目标|未来五年规划|未来三到五年规划|职业生涯规划|发展规划|个人发展规划',
    'Where do you see yourself in five years|Where do you see yourself in 5 years|Career goals|Career plan|Career aspirations|Career objectives|Long-term goals|Future plans|Professional goals|Career development goals',
  ),
  'misc.hobbies': s(
    '兴趣爱好|爱好|兴趣|特长爱好|兴趣特长|业余爱好|个人爱好|爱好特长',
    'Hobbies|Interests|Hobbies and interests|Interests and hobbies|Personal interests|Outside interests|Hobbies & interests',
  ),
  'attachments.resume': s(
    '简历|上传简历|简历附件|附件简历|简历文件|个人简历|上传附件简历|电子简历|简历上传|上传您的简历',
    'Resume|Resume/CV|CV|Upload resume|Upload your resume|Upload CV|Attach resume|Attach your CV|Resume upload|CV upload|Curriculum vitae|Resume file',
    '照片|成绩单|封面|求职信|photo|transcript|cover|picture|portrait',
  ),
  'attachments.photo': s(
    '照片|证件照|个人照片|上传照片|头像|上传头像|免冠照片|一寸照片|一寸照|电子照片|相片',
    'Photo|Photo upload|Profile photo|Profile picture|Upload photo|Picture|Headshot|Passport photo|Your photo|Avatar',
  ),
  // A link on a text box is contact.portfolio, under the same words: the box's kind tells the two apart.
  'attachments.portfolio': s(
    '作品集|作品附件|作品集附件|上传作品集|作品集文件|作品文件|上传作品|个人作品集',
    'Portfolio|Portfolio upload|Upload portfolio|Upload your portfolio|Portfolio file|Work samples|Work sample|Design portfolio|Attach portfolio',
    // One box for both takes the resume.
    '简历|resume|cv',
  ),
  'attachments.transcript': s(
    '成绩单|上传成绩单|成绩单附件|学业成绩单|在校成绩单|成绩证明',
    'Transcript|Academic transcript|Academic record|Official transcript|Upload transcript|Transcript upload|Academic results|Record of results|Statement of results',
  ),
};
