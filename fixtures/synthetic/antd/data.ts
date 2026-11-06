// Option lists for the antd fixture. Every option's `value` equals its visible label, so the
// form model (and therefore __fixtureState) reports what the user sees.

export interface Opt {
  value: string;
  label: string;
}

export const opts = (labels: readonly string[]): Opt[] => labels.map((v) => ({ value: v, label: v }));

export const ETHNICITIES = opts(['汉族', '回族', '满族', '壮族', '蒙古族', '维吾尔族', '藏族']);
export const POLITICAL = opts(['中共党员', '中共预备党员', '共青团员', '群众']);
export const PHONE_CODES = opts(['+86', '+852', '+61']);
export const CITIES = opts(['北京', '上海', '深圳', '杭州', '广州']);
export const SCHOOLS = opts(['浙江大学', '澳大利亚国立大学', '清华大学', '北京大学', '浙江工业大学']);
export const DEGREES = opts(['大专', '本科', '硕士研究生', '博士研究生']);
export const ENGLISH_LEVELS = opts(['CET-4', 'CET-6', '专业四级', '专业八级', '无']);
export const FOREIGN_LANGUAGES = opts(['日语', '韩语', '法语']);
export const AWARD_LEVELS = opts(['国家级', '省级', '市级', '校级']);

export interface Region {
  value: string;
  label: string;
  children?: Region[];
}

const node = (label: string, children?: Region[]): Region => (children ? { value: label, label, children } : { value: label, label });

// Province / city / district tree (value === label).
export const REGIONS_3: Region[] = [
  node('浙江省', [
    node('杭州市', [node('西湖区'), node('滨江区')]),
    node('宁波市', [node('鄞州区')]),
  ]),
  node('广东省', [node('深圳市', [node('南山区'), node('福田区')]), node('广州市', [node('天河区')])]),
  node('北京市', [node('北京市', [node('朝阳区'), node('海淀区')])]),
];

// Province / city only (籍贯).
export const REGIONS_2: Region[] = REGIONS_3.map((p) => ({
  ...p,
  children: p.children?.map((c) => node(c.label)),
}));
