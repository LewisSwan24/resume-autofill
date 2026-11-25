// Hand-written zh/en label synonyms for the array modules (education, work, projects, campus, awards,
// languages, certificates, skills, family, emergency contact, referees). The same generic label
// ("姓名", "Name", "开始时间") may appear under several modules; the section context chooses between them.
import { s, type FieldSynonym } from './fieldData';

const SPAN_ZH = '起止时间|起止日期|起止年月|时间段';
const NOT_A_SPAN = '参加|首次|开始|结束|截止|要求|到岗|入职|离职|毕业|入学';
const START_ZH = '开始时间|开始日期|起始时间|起始日期|开始年月';
const START_EN = 'Start date|Start|From|From date|Date started|Start month and year';
const END_ZH = '结束时间|结束日期|终止时间|截止时间|截止日期|结束年月';
const END_EN = 'End date|End|To|To date|Date finished|Finish date|End month and year';

export const MODULE_FIELD_SYNONYMS: Record<string, FieldSynonym> = {
  // ------------------------------------------------------------ education
  'education.school': s(
    '学校|学校名称|毕业院校|毕业学校|院校|院校名称|就读学校|就读院校|大学|学校全称|所在学校',
    'Institution|Institution name|School|School name|University|University name|College|College/University|School/University|Name of institution|Educational institution|Name of school|Institution attended',
    '英文|中学|地址|城市|国家|所在地|english|high school|address|city|location|country|faculty|department|院系|编号|number',
  ),
  'education.schoolEn': s(
    '学校英文名|学校英文名称|院校英文名称|学校名称(英文)|英文学校名称|毕业院校英文名',
    'School name (English)|School name in English|Institution name (English)|University name in English|English name of school|School (English)',
  ),
  'education.country': s(
    '学校所在国家|院校所在国家/地区|就读国家|留学国家|学校国家|毕业院校所在国家|留学国家/地区',
    'Country of study|School country|Institution country|Country of institution|University country|Country where you studied|Country of education',
  ),
  'education.city': s(
    '学校所在城市|学校所在地|院校所在地|院校所在城市|学校地点|就读城市|城市|所在地|所在地点|学校所在地点|院校所在地点',
    'School city|Institution city|Institution location|School location|University location|City of institution|City of study|City|Location',
  ),
  'education.classYear': s(
    '届别|毕业届别|所属届别|毕业届|届次|应届届别',
    'Class of|Graduating class|Graduation class|Graduating year group',
  ),
  'education.supervisor': s(
    '在校导师|导师|导师姓名|指导老师|指导教师|研究生导师|论文导师|学业导师',
    // Not a bare Supervisor: in a job's card that is the manager there.
    'Academic supervisor|Thesis supervisor|Research supervisor|PhD supervisor|Academic advisor',
    '电话|手机|邮箱|职称|单位|方向|phone|mobile|email|title|position',
  ),
  'education.degree': s(
    '学历|学位|学历/学位|最高学历|最高学位|学历层次|学历学位|学历水平|受教育程度|教育程度|文化程度|毕业学历',
    'Degree|Degree level|Degree type|Qualification|Qualification level|Level of education|Education level|Highest level of education|Highest level of tertiary education|Highest qualification|Level of study|Type of degree|Degree/qualification',
    '编号|证书|证号|授予|论文|number|certificate|专业|major|name of degree',
  ),
  'education.educationType': s(
    '学历类型|学历性质|学习形式|学习方式|教育形式|学制类型|培养方式|就读方式|教育类型|全日制/非全日制|是否全日制|学习类型',
    'Study mode|Mode of study|Study type|Study load|Education type|Attendance|Attendance mode|Enrolment type|Full-time/part-time study',
  ),
  'education.major': s(
    '专业|专业名称|所学专业|就读专业|主修专业|专业方向|学习专业|毕业专业',
    'Major|Field of study|Area of study|Course|Course name|Degree name|Program|Programme|Program name|Specialisation|Specialization|Degree program|Study area|Discipline|Subject|Main subject|Course of study|Field of study/major',
    '排名|辅修|课程|绩点|成绩|ranking|rank|minor|courses|coursework|gpa|score|second',
  ),
  'education.minor': s(
    '辅修专业|辅修|第二专业|双学位专业|双专业|辅修方向',
    'Minor|Minor subject|Minor in|Second major|Secondary major|Double major',
  ),
  'education.department': s(
    '学院|院系|所在院系|院系名称|系|学院名称|所在学院|系别|专业院系',
    'Department|Faculty|School/Faculty|Faculty/School|Faculty or department|School of|Division|Faculty/Department',
  ),
  'education.startDate': s(
    `${START_ZH}|入学时间|入学日期|入学年月|就读开始时间`,
    `${START_EN}|Enrolment date|Year commenced|Date commenced|Commencement date|Admission date`,
  ),
  'education.endDate': s(
    `${END_ZH}|毕业时间|毕业日期|毕业年月|预计毕业时间|预计毕业日期|离校时间|毕业年份`,
    `${END_EN}|Graduation date|Expected graduation date|Date of graduation|Year completed|Completion date|Date completed|Expected completion date|Graduation year`,
  ),
  'education.current': s(
    '至今|在读|是否在读|是否在校|目前在读|尚未毕业|仍在就读',
    'Currently studying|I currently study here|Still studying|Present|Current student|Currently enrolled|Ongoing',
  ),
  'education.gpa': s(
    '绩点|平均绩点|成绩|学分绩点|平均成绩|学业成绩|加权平均分|平均分|均分|加权平均',
    'GPA|Grade point average|Cumulative GPA|WAM|Weighted average mark|Average mark|Overall GPA|Overall average|Final grade|Marks',
    '满分|总分|制|最高|排名|scale|out of|max|rank|total',
  ),
  'education.gpaScale': s(
    '绩点满分|满分|总分|绩点制|绩点制度|成绩满分|GPA满分|满分值|绩点总分',
    'GPA scale|GPA out of|Maximum GPA|Grading scale|GPA total|Out of|Max GPA|Scale|GPA maximum',
  ),
  'education.ranking': s(
    '专业排名|成绩排名|排名|年级排名|班级排名|综合排名|绩点排名|排名百分比|排名比例|综合测评排名',
    'Class rank|Rank|Ranking|Academic ranking|Class ranking|Rank in class|Percentile|Academic rank',
  ),
  'education.courses': s(
    '主修课程|相关课程|核心课程|专业课程|主要课程|课程|所修课程|课程设置|专业核心课程|修读课程',
    'Relevant coursework|Relevant courses|Coursework|Courses|Key subjects|Major courses|Core courses|Subjects studied|Main subjects',
  ),
  'education.thesis': s(
    '毕业论文|论文题目|毕业设计|论文|毕业论文题目|论文名称|研究课题',
    'Thesis|Thesis title|Dissertation|Dissertation title|Research topic|Research title|Capstone|Final year project|Honours thesis|Research area',
  ),
  'education.honors': s(
    '在校荣誉|荣誉奖励|在校获奖|在校奖励|奖学金|获得荣誉|荣誉|校内荣誉|在校期间荣誉|在校表现',
    'Academic honours|Honours|Honors|Scholarships|Academic awards|Academic achievements|Awards and honours|Academic scholarship|Distinctions|Prizes',
  ),

  // ------------------------------------------------------------ work / internship
  'work.kind': s(
    '经历类型|经历性质|工作经历类型|实习还是工作|经历分类',
    'Experience type|Type of experience|Work experience type|Experience category|Internship or employment',
  ),
  'work.company': s(
    '公司|公司名称|单位|单位名称|工作单位|就职单位|任职公司|所在公司|实习单位|实习公司|雇主|用人单位|企业名称|公司全称|机构|机构名称',
    'Company|Company name|Current company|Employer|Employer name|Organisation|Organization|Organisation name|Name of organisation|Business name|Workplace|Previous employer|Current employer|Most recent employer',
    '成员|家属|亲属|配偶|地址|电话|邮箱|行业|规模|城市|网站|性质|address|phone|email|industry|size|city|website|location|type',
  ),
  'work.position': s(
    '职位|职位名称|岗位|岗位名称|职务|担任职务|任职岗位|工作职位|工作岗位|实习岗位|实习职位',
    'Job title|Position|Position title|Role|Job role|Title|Role title|Designation|Position held|Your role|Job position',
    '应聘|申请|期望|意向|报考|志愿|类型|applying|applied|desired|preferred|expected|type',
  ),
  'work.department': s(
    '部门|所在部门|任职部门|工作部门|部门名称|团队|所属部门',
    'Department|Team|Division|Business unit|Department/team|Function',
  ),
  'work.city': s(
    '工作城市|工作地点|工作地|就职城市|公司所在地|公司所在城市|公司地点|实习城市|实习地点|城市|所在地|所在地点|公司所在地点',
    'Work location|Job location|Company location|Employer location|Location|Work city|Place of work|City',
  ),
  'work.period': s(
    `${SPAN_ZH}|在职时间|工作时间|工作起止时间|任职时间|任职起止时间|实习时间|实习起止时间`,
    'Dates of employment|Employment dates|Employment period|Period of employment|Dates employed',
    NOT_A_SPAN,
  ),
  'education.period': s(
    `${SPAN_ZH}|在校时间|就读时间|在读时间|学习时间|学习起止时间|教育时间`,
    'Dates of attendance|Dates attended|Study period|Period of study',
    NOT_A_SPAN,
  ),
  'projects.period': s(
    `${SPAN_ZH}|项目时间|项目周期|项目起止时间`,
    'Project dates|Project period',
    NOT_A_SPAN,
  ),
  'campus.period': s(
    `${SPAN_ZH}|任职时间|担任时间|在任时间|活动时间`,
    'Dates of involvement|Period of involvement',
    NOT_A_SPAN,
  ),
  'work.startDate': s(
    `${START_ZH}|入职时间|入职日期|开始工作时间|工作开始时间|实习开始时间`,
    `${START_EN}|Employment start date|Job start date|Date commenced`,
  ),
  'work.endDate': s(
    `${END_ZH}|离职时间|离职日期|工作结束时间|实习结束时间`,
    `${END_EN}|Employment end date|Date left|Leaving date`,
  ),
  'work.current': s(
    '至今|是否在职|是否仍在职|目前在职|我目前在此工作|至今在职|目前仍在职',
    'I currently work here|I currently work in this role|Currently working here|Still working here|Current job|Present|Currently employed here|This is my current role',
  ),
  'work.description': s(
    '工作内容|工作描述|工作职责|职责描述|主要职责|工作业绩|工作成果|实习内容|实习描述|岗位职责|工作经历描述|经历描述|具体工作|描述',
    'Description|Job description|Role description|Responsibilities|Duties|Key responsibilities|Main duties|Duties and responsibilities|Key achievements|Role and responsibilities|Describe your role|Achievements|Summary of duties',
  ),

  // ------------------------------------------------------------ projects
  'projects.name': s(
    '项目名称|项目|项目名|项目题目|项目标题',
    'Project name|Project|Project title|Project name/title|Name of project',
  ),
  'projects.role': s(
    '项目角色|担任角色|角色|项目中的角色|项目职位|我的角色|项目担任',
    'Role|Project role|Your role|Role in project|Position in project|Responsibility',
  ),
  'projects.startDate': s(
    `${START_ZH}|项目开始时间|项目开始日期`,
    `${START_EN}|Project start date`,
  ),
  'projects.endDate': s(
    `${END_ZH}|项目结束时间|项目完成时间`,
    `${END_EN}|Project end date|Completion date`,
  ),
  'projects.current': s(
    '至今|进行中|项目进行中|是否进行中|项目仍在进行',
    'Ongoing|Present|Project ongoing|Currently working on this project|In progress',
  ),
  'projects.description': s(
    '项目描述|项目内容|项目简介|项目介绍|项目职责|项目成果|项目业绩|项目经历描述|主要工作',
    'Project description|Project details|Project summary|Project overview|Description|Responsibilities|Outcomes|Describe the project',
  ),
  // What the applicant did in the project, asked apart from what the project was: drafted from the role and the
  // description, written only when the applicant says so. A plain 项目职责 stays the description, filled as before.
  'projects.duties': s(
    '项目中职责|项目中的职责|项目中承担的职责|个人职责|本人职责|个人负责内容|本人负责内容|你在项目中的职责|你在项目中负责什么|承担工作',
    'Your responsibilities in the project|Your responsibilities|Your contribution|Your contributions|What was your contribution|What did you do on this project|My responsibilities|Personal contribution',
  ),
  'projects.link': s(
    '项目链接|项目地址|项目网址|项目主页|作品链接|代码链接|仓库地址',
    'Project link|Project URL|Project link/URL|Demo link|Repository|Repository URL|Link|URL',
  ),

  // ------------------------------------------------------------ campus
  'campus.organization': s(
    '组织|组织名称|社团|社团名称|学生组织|学生组织名称|活动名称|社团/组织名称|所属组织|参与组织',
    'Organisation|Organization|Club|Society|Club/society|Student organisation|Student club|Activity|Activity name|Extracurricular activity|Name of organisation',
  ),
  'campus.role': s(
    '校内职务|学生职务|担任职务|担任角色|职务|职位|角色|社团职务|学生干部职务|活动角色',
    'Role|Position|Position held|Title|Role in organisation|Role in activity',
  ),
  'campus.startDate': s(
    `${START_ZH}|活动开始时间|任职开始时间`,
    `${START_EN}|Activity start date`,
  ),
  'campus.endDate': s(
    `${END_ZH}|活动结束时间|任职结束时间`,
    `${END_EN}|Activity end date`,
  ),
  'campus.current': s(
    '至今|任职中|是否在任|目前在任|活动进行中',
    'Ongoing|Present|Currently involved|I am currently involved|Current role',
  ),
  'campus.description': s(
    '活动描述|活动内容|经历描述|主要工作|工作内容|所获成就|主要职责|描述|社团经历描述|实践内容',
    'Description|Activity description|Responsibilities and achievements|Details|Achievements|Activity details',
  ),

  // ------------------------------------------------------------ awards
  'awards.name': s(
    '奖项名称|获奖名称|奖励名称|荣誉名称|奖项|荣誉称号|所获奖项|获奖项目|奖励|荣誉',
    'Award|Award name|Award title|Name of award|Honour|Honor|Scholarship|Prize|Achievement|Accomplishment|Honour/award',
  ),
  'awards.date': s(
    '获奖时间|获奖日期|获奖年月|颁发时间|颁奖时间|授予时间|时间',
    'Award date|Date awarded|Date received|Date of award|Year awarded|Year received|Date',
    '起止|在职|在校|在读|入职|离职',
  ),
  'awards.level': s(
    '奖项级别|获奖级别|奖励级别|奖项等级|荣誉级别|级别|获奖等级|奖励等级|荣誉等级',
    'Award level|Level of award|Award scope|Level|Award type|Award category',
  ),
  'awards.issuer': s(
    '颁发单位|颁奖单位|颁发机构|授予单位|发奖单位|颁发组织|授予机构|评选单位|主办单位',
    'Issuer|Issued by|Awarding body|Awarded by|Awarding organisation|Granted by|Issuing organisation|Organisation',
  ),
  'awards.description': s(
    '奖项说明|获奖说明|获奖描述|获奖情况|获奖详情|获奖经历|荣誉描述|奖项描述|获奖情况描述|说明|描述',
    'Award description|Description|Details|Award details|Reason for award',
  ),

  // ------------------------------------------------------------ languages
  'languages.language': s(
    '语种|语言|外语语种|语言种类|外语|语言名称|语言类型|外语类型|外语种类|语言技能|掌握语言|掌握的语言',
    'Language|Language name|Foreign language|Other language|Language spoken',
    '等级|水平|证书|成绩|level|proficiency|certificate|score|test',
  ),
  'languages.proficiency': s(
    '精通程度|熟练程度|掌握程度|语言水平|语言能力|外语水平|掌握情况|听说能力|读写能力|水平|熟练度|语言熟练度|外语能力',
    'Proficiency|Language proficiency|Proficiency level|Fluency|Level|Language level|Speaking level|Skill level',
    '证书|考试|成绩|certificate|test|exam|score',
  ),
  'languages.certificate': s(
    '英语等级|外语等级|语言等级|语言证书|外语证书|英语证书|等级证书|语言考试|语言考试类型|英语考试|考试类型|英语水平考试|英语四六级|四六级|所获证书|已获证书|获得证书',
    'Language certificate|Language test|English test|English test type|Test type|Language qualification|Language exam|English proficiency test|Test taken',
  ),
  'languages.score': s(
    '成绩|分数|考试成绩|语言成绩|得分|总分|英语成绩|英语分数|四六级成绩|四六级分数|四级成绩|四级分数|六级成绩|六级分数|英语四级成绩|英语六级成绩|专四成绩|专四分数|专八成绩|专八分数|雅思成绩|雅思分数|托福成绩|托福分数|证书成绩',
    'Score|Test score|Overall score|Language score|Result|Band score|IELTS score|TOEFL score|Overall band',
  ),

  // ------------------------------------------------------------ certificates
  'certificates.name': s(
    '证书名称|证书|证书名|资格证书|资格证书名称|技能证书|职业资格|资格证|所获证书|证书/资质',
    'Certificate|Certificate name|Certification|Certification name|Licence|License|Licence/certification|Name of certificate',
    '编号|日期|颁发|机构|语言|number|date|issu|language',
  ),
  'certificates.date': s(
    '获得时间|获证时间|获得日期|取得时间|取得日期|发证日期|发证时间|颁发日期|证书获得时间|证书日期',
    'Date obtained|Date issued|Issue date|Date achieved|Date earned|Date of issue|Year obtained|Date',
  ),
  'certificates.issuer': s(
    '发证机构|颁发机构|发证单位|颁发单位|认证机构|发证机关|证书颁发机构',
    'Issuing organisation|Issuing authority|Issuing body|Issued by|Certifying body|Certification body|Issuer',
  ),
  'certificates.number': s(
    '证书编号|证书号|证书号码|编号|证件编号|资格证书编号|证书序号',
    'Certificate number|Certificate no|Certificate ID|Credential ID|Licence number|License number|Registration number|Credential number',
  ),

  // ------------------------------------------------------------ skills
  'skills.name': s(
    '技能|技能名称|专业技能|技能名|技能特长|特长|掌握技能|技能/工具|软件技能|工具',
    'Skill|Skill name|Skills|Technical skills|Key skills|Tool|Technology|Technologies|Software|Competencies',
  ),
  'skills.level': s(
    '熟练程度|掌握程度|技能等级|技能水平|熟练度|水平|技能熟练度|掌握水平',
    'Skill level|Proficiency|Level|Years of experience|Competency level|Expertise|Experience level|Rating',
  ),

  // ------------------------------------------------------------ family
  'family.name': s(
    '姓名|成员姓名|家庭成员姓名|亲属姓名|家属姓名|家人姓名',
    'Name|Family member name|Relative\'s name|Member name|Full name|Name of family member',
  ),
  'family.relationship': s(
    '与本人关系|关系|成员关系|亲属关系|称谓|家庭关系|与本人的关系|与您的关系|与申请人关系|亲属称谓',
    'Relationship|Relationship to you|Relation|Relationship to applicant|Relation to you',
    '状态|status|politic',
  ),
  'family.employer': s(
    '成员工作单位|工作单位|单位|所在单位|单位名称|工作单位名称|就职单位',
    'Employer|Workplace|Company|Organisation|Employer name|Place of work',
  ),
  'family.position': s(
    '职务|职位|工作职务|职业|岗位|担任职务',
    'Position|Occupation|Job title|Title|Profession',
  ),
  'family.phone': s(
    '联系电话|电话|手机|手机号码|联系方式|电话号码|成员电话|家属电话|联系手机',
    'Phone|Phone number|Mobile|Contact number|Telephone|Contact phone',
  ),
  'family.politicalStatus': s(
    '政治面貌|成员政治面貌|党派|政治身份|家属政治面貌',
    'Political status|Political affiliation|Party affiliation|Political party',
  ),

  // ------------------------------------------------------------ emergency contact
  'emergencyContact.name': s(
    '紧急联系人|紧急联系人姓名|紧急联络人|应急联系人|紧急联系人名称|联系人|联系人姓名|联络人姓名|姓名',
    'Emergency contact|Emergency contact name|Emergency contact person|Name of emergency contact|Contact name|Next of kin|Next of kin name|Name',
    '邮箱|地址|email|e-mail|address',
  ),
  'emergencyContact.relationship': s(
    '与紧急联系人关系|紧急联系人关系|与本人关系|关系|联系人关系|与联系人关系|应急联系人关系',
    'Emergency contact relationship|Relationship to emergency contact|Relationship|Relationship to you|Next of kin relationship',
  ),
  'emergencyContact.phone': s(
    '紧急联系人电话|紧急联系人手机|紧急联系电话|紧急联系方式|联系人电话|联系人手机|应急联系电话|电话|联系电话',
    'Emergency contact phone|Emergency contact number|Emergency phone|Emergency contact mobile|Next of kin phone|Phone|Phone number|Mobile',
  ),

  // ------------------------------------------------------------ referees
  'referees.name': s(
    '推荐人|推荐人姓名|证明人|证明人姓名|担保人|推荐人名称|姓名',
    'Referee|Referee name|Reference name|Name of referee|Reference|Referee full name|Name',
    '工号|编号|内推|referral|employee id|staff id|number',
  ),
  'referees.title': s(
    '推荐人职位|推荐人职务|证明人职位|证明人职务|职位|职务',
    'Referee title|Referee position|Referee job title|Job title|Position|Title|Position/title',
  ),
  'referees.company': s(
    '推荐人公司|推荐人单位|证明人单位|证明人公司|公司|单位|所在公司',
    'Referee company|Referee organisation|Referee employer|Company|Organisation|Employer',
  ),
  'referees.email': s(
    '推荐人邮箱|推荐人邮件|证明人邮箱|邮箱|电子邮箱',
    'Referee email|Referee email address|Reference email|Email|Email address',
  ),
  'referees.phone': s(
    '推荐人电话|推荐人手机|证明人电话|证明人手机|联系电话|电话',
    'Referee phone|Referee phone number|Referee mobile|Reference phone|Phone|Phone number|Mobile',
  ),
  'referees.relationship': s(
    '与推荐人关系|与推荐人的关系|与证明人关系|关系|推荐人关系|认识方式',
    'How do you know this referee|How do you know them|Relationship to referee|Relationship|Capacity known|Relationship with referee|Referee relationship',
    '工号|编号|内推|referral|employee id|staff id|number',
  ),
};
