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
}

export const s = (zh: string, en: string, exclude = ''): FieldSynonym => {
  const split = (v: string) => v.split('|').map((x) => x.trim()).filter(Boolean);
  const out: FieldSynonym = { zh: split(zh), en: split(en) };
  if (exclude) out.exclude = split(exclude);
  return out;
};

/** Labels that belong to an organisation/other entity rather than a person's own name. */
const NOT_PERSON = '公司|单位|学校|院校|项目|奖|证书|组织|社团|推荐人|证明人|紧急|联系人|家庭|家属|亲属|company|employer|school|university|institution|project|award|certificate|organi|referee|emergency|contact|family member|file name|user name|username';
/** Region-ish qualifiers that make a plain "city / province / country" label something else. */
const OTHER_PLACE = '籍贯|户口|户籍|生源|出生|学校|院校|公司|单位|期望|意向|工作|birth|school|university|company|employer|work|preferred|desired|expected';

export const PERSONAL_FIELD_SYNONYMS: Record<string, FieldSynonym> = {
  // ------------------------------------------------------------ basics
  'basics.fullName': s(
    '姓名|全名|真实姓名|中文姓名|姓名全称|您的姓名|申请人姓名|应聘者姓名|求职者姓名|本人姓名',
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
    '出生日期|出生年月|出生年月日|生日|出生时间|出生日|出生年份',
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
    '籍贯|祖籍|原籍|出生地|籍贯所在地|出生地点|出生地(省市)',
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
    '现居住地|现居地|居住地|当前所在地|目前所在地|现所在地|所在地|居住城市|现居城市|现居住城市',
    'Current location|Current city|Location (City)|Location City|Where are you based|Where are you located|Where are you currently located|Where are you currently based|Current residence|City of residence|Place of residence',
    '期望|意向|工作地|学校|院校|公司|单位|preferred|desired|expected|school|company|employer|work',
  ),
  'basics.age': s(
    '年龄|岁数|周岁|实际年龄|您的年龄',
    'Age|Your age|Age (years)|Current age|Age in years',
  ),

  // ------------------------------------------------------------ contact
  'contact.email': s(
    '邮箱|电子邮箱|电子邮件|邮件|常用邮箱|个人邮箱|确认邮箱|再次输入邮箱|邮箱确认|邮箱地址|电子邮件地址',
    'Email|E-mail|Email address|Confirm email|Confirm email address|Re-enter email|Retype email|Personal email|Email (confirm)',
    '推荐人|证明人|验证|紧急|referee|reference|verif|emergency|code',
  ),
  'contact.phoneCountryCode': s(
    '国家区号|区号|国家代码|手机区号|国际区号|国家/地区代码|电话区号|国家码',
    'Country code|Phone country code|Dialing code|Dialling code|Calling code|Country calling code|Mobile country code|International dialing code',
    '邮编|邮政|post|zip',
  ),
  'contact.phone': s(
    '手机|手机号|手机号码|联系电话|电话|联系手机|移动电话|电话号码|常用电话|联系电话(手机)|本人手机',
    'Phone|Phone number|Mobile|Mobile number|Mobile phone|Contact number|Telephone|Cell phone|Contact phone|Mobile/phone',
    '紧急|应急|家庭|推荐人|证明人|区号|验证|emergency|referee|reference|country code|verif|code|family|next of kin',
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
    '邮编|邮政编码|邮政编号|邮码',
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
    'Work rights|Work rights status|Work authorisation|Work authorization|Visa status|Working rights|Citizenship status|Residency status|Immigration status|Visa/work rights|Current work rights|Work rights in Australia|Work rights in your country',
    '担保|赞助|需要|是否有|sponsor|do you have|full work|are you|require',
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
  ),
  'workRights.hasFullWorkRights': s(
    '是否拥有完整工作权利|是否有工作权利|是否有合法工作资格|是否可以合法工作|完整工作权利|是否有完整工作权利|是否有权在澳工作',
    'Full work rights|Do you have full work rights|Do you have the right to work|Right to work in Australia|Legally authorised to work|Legally authorized to work|Unrestricted work rights|Eligible to work|Authorised to work|Authorized to work',
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
    'Minimum salary|Min salary|Salary from|Salary range from|Expected salary|Minimum expected salary|Lowest salary|Salary expectation|Desired salary',
    '最高|上限|maximum|max|highest|upper',
  ),
  'jobIntention.salaryMax': s(
    '最高薪资|薪资上限|期望薪资上限|最高月薪|最高期望薪资|薪资最高',
    'Maximum salary|Max salary|Salary to|Salary range to|Maximum expected salary|Highest salary|Upper salary',
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
    '到岗时间|最快到岗时间|可到岗时间|期望到岗时间|可入职时间|预计入职时间|最早入职时间|期望入职时间|最早到岗日期',
    'Earliest start date|Available from|Availability date|Available start date|Date available|When can you start|Available to start|Earliest availability|Commencement date|Preferred start date|Availability',
    '毕业|学校|graduat|school|education',
  ),
  'jobIntention.noticePeriod': s(
    '通知期|离职通知期|离职交接期|到岗通知期|需提前通知时间|提前通知期|离职通知时间',
    'Notice period|Notice required|Current notice period|Length of notice|Period of notice|How much notice|How much notice do you need to give|Notice',
  ),
  'jobIntention.acceptAdjustment': s(
    '是否服从调剂|是否接受调剂|是否同意调剂|是否服从分配|服从调剂|接受调剂|是否服从岗位调剂|是否服从调配|是否愿意调剂',
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
    '自我评价|自我介绍|个人简介|个人介绍|自我描述|个人总结|个人优势|个人陈述|个人特点|自荐|自荐信|个人评价',
    'Tell us about yourself|About you|About me|Introduce yourself|Personal statement|Professional summary|Personal summary|Cover letter|Bio|Short bio|Describe yourself|Self introduction|Self-introduction|Self assessment',
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
  'attachments.transcript': s(
    '成绩单|上传成绩单|成绩单附件|学业成绩单|在校成绩单|成绩证明',
    'Transcript|Academic transcript|Academic record|Official transcript|Upload transcript|Transcript upload|Academic results|Record of results|Statement of results',
  ),
};
