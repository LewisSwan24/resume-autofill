// Option lists for the Element Plus fixture. Every option's value equals its visible label, so the
// form model (and therefore __fixtureState) reports what the user sees.

export const POLITICAL = ['中共党员', '中共预备党员', '共青团员', '群众'];
export const MARITAL = ['未婚', '已婚', '离异'];
export const DEGREES = ['本科', '硕士研究生', '博士研究生'];
export const ACADEMIC_DEGREES = ['学士', '硕士', '博士'];
// Remote school list: the select starts with no options and only shows matches after a search.
export const SCHOOLS = ['浙江大学', '昆士兰大学', '清华大学', '北京大学', '浙江工业大学'];

export interface Region {
  value: string;
  label: string;
  children?: Region[];
}

const node = (label: string, children?: Region[]): Region =>
  children ? { value: label, label, children } : { value: label, label };

// Province / city / district tree (value === label).
export const REGIONS: Region[] = [
  node('浙江省', [
    node('杭州市', [node('西湖区'), node('滨江区')]),
    node('宁波市', [node('鄞州区')]),
  ]),
  node('广东省', [node('深圳市', [node('南山区'), node('福田区')]), node('广州市', [node('天河区')])]),
  node('北京市', [node('北京市', [node('朝阳区'), node('海淀区')])]),
];
