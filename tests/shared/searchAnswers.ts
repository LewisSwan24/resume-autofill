// Place searches a replay can answer. A location box asks a search service as the applicant types, and a
// recording holds only what was asked while it ran, which was never the sample resume's city. Each answer here
// is what that service sent back on the live page (every write blocked) when "Canberra" was typed into it,
// saved as it came. With it the whole pick runs offline: the page's own script draws the rows, the engine picks
// one, and the page keeps it or not.
//
// Only the exact words asked on the live page get an answer. Anything else stays unanswered and falls through
// to the recording, which aborts it: a replay must not make up a service's answer.
//
// Rippling's box asks Google Places through the Maps script, which no capture holds and which cannot be stood
// in for honestly, so it has nothing here.
//
// School, major and region boxes (Chinese campus portals search all three) follow the same rules. A service
// asks in one of four shapes, each with a reader below: a GET parameter, a POSTed form, a POSTed JSON body, or
// a GraphQL variable. `where` names fields the request always carries, for an endpoint that serves several
// searches (a `type: 'school'` beside a `type: 'major'`).
import type { BrowserContext } from '@playwright/test';

export interface SearchRequest {
  method: string;
  url: string;
  postData: string | null;
}

export interface SearchAnswer {
  contentType: string;
  body: string;
}

export type SearchKind = 'place' | 'school' | 'major' | 'region';

type Asked = (request: SearchRequest, url: URL) => string | null;

export interface SearchService {
  kind: SearchKind;
  /** The words a request searches for, or null when it is not this service's search. */
  asked: Asked;
  /** Words asked → the service's whole answer, as it came. A string is sent as it is; anything else as JSON. */
  answers: Record<string, unknown>;
  /** The content type the service answered with. JSON when left out. */
  contentType?: string;
}

const JSON_TYPE = 'application/json; charset=utf-8';

type Where = Record<string, string | number | boolean>;

const at = (host: string, pathname: string, method: string, request: SearchRequest, url: URL): boolean =>
  request.method === method && url.host === host && url.pathname === pathname;

const parseJson = (text: string | null): unknown => {
  try {
    return JSON.parse(text ?? '');
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

const holds = (read: (key: string) => unknown, where: Where): boolean => Object.entries(where).every(([k, v]) => String(read(k)) === String(v));

/** A GET whose words are one query parameter. */
export const getParam =
  (host: string, pathname: string, param: string, where: Where = {}): Asked =>
  (request, url) =>
    at(host, pathname, 'GET', request, url) && holds((k) => url.searchParams.get(k), where) ? url.searchParams.get(param) : null;

/** A POSTed form (application/x-www-form-urlencoded) whose words are one field. */
export const postFormParam =
  (host: string, pathname: string, param: string, where: Where = {}): Asked =>
  (request, url) => {
    if (!at(host, pathname, 'POST', request, url) || parseJson(request.postData) !== undefined) return null;
    const form = new URLSearchParams(request.postData ?? '');
    return holds((k) => form.get(k), where) ? form.get(param) : null;
  };

/** A POSTed JSON body whose words sit at `field`, a path of keys from the top. */
export const postJsonField =
  (host: string, pathname: string, field: string[], where: Where = {}): Asked =>
  (request, url) => {
    if (!at(host, pathname, 'POST', request, url)) return null;
    const body = parseJson(request.postData);
    if (!isRecord(body) || !holds((k) => body[k], where)) return null;
    let value: unknown = body;
    for (const key of field) value = isRecord(value) ? value[key] : undefined;
    return typeof value === 'string' ? value : null;
  };

/** A GraphQL operation whose words are one variable, POSTed as JSON or sent as GET parameters. */
export const graphqlVariable =
  (host: string, pathname: string, operationName: string, variable: string): Asked =>
  (request, url) => {
    let body: unknown;
    if (at(host, pathname, 'POST', request, url)) body = parseJson(request.postData);
    else if (at(host, pathname, 'GET', request, url)) {
      body = { operationName: url.searchParams.get('operationName'), variables: parseJson(url.searchParams.get('variables')) };
    }
    if (!isRecord(body) || body.operationName !== operationName || !isRecord(body.variables)) return null;
    const words = body.variables[variable];
    return typeof words === 'string' ? words : null;
  };

const ashbyGeoLocation = (name: string, region: string, cityId: string) => ({
  name,
  geoLocationPath: [
    { name: 'Australia', type: 'Country', providerLocationId: 'australia', __typename: 'GeoLocation' },
    { name: region, type: 'Region', providerLocationId: 'australia/australian_capital territory', __typename: 'GeoLocation' },
    { name: name.split(',')[0], type: 'City', providerLocationId: `australia/australian_capital territory/${cityId}`, __typename: 'GeoLocation' },
  ],
  __typename: 'AutocompleteLocation',
});

const SERVICES: SearchService[] = [
  {
    // jobs.lever.co/js/retrieveLocations.js: a GET per pause in typing, an array of { name, id }.
    kind: 'place',
    asked: getParam('jobs.lever.co', '/searchLocations', 'text'),
    answers: {
      Canberra: [
        { name: 'Canberra, Australian Capital Territory, AUS', id: 'ef0d301eeba1a0768f7465a6ec28029458b335a9' },
        { name: 'Canberra, Gweru, Midlands, ZWE', id: '38157a8783b70baa967f0706aee455242fb16e64' },
        { name: 'Canberra, AUS', id: '1a2945f40089d2a7d6d6d0da8e77104f740c06a1' },
      ],
    },
  },
  {
    // Greenhouse's job boards ask a Pelias geocoder (geocode.earth) through their own proxy.
    kind: 'place',
    asked: getParam('api-geocode-earth-proxy.greenhouse.io', '/v1/autocomplete', 'text'),
    answers: {
      Canberra: {
        geocoding: {
          version: '0.2',
          attribution: 'https://geocode.earth/guidelines',
          query: {
            text: 'Canberra',
            parser: 'pelias',
            parsed_text: { subject: 'Canberra', locality: 'Canberra' },
            size: 10,
            layers: ['locality'],
            private: false,
            lang: { name: 'English', iso6391: 'en', iso6393: 'eng', via: 'querystring', defaulted: false },
            querySize: 20,
          },
          engine: { name: 'Pelias', author: 'Mapzen', version: '1.0' },
          timestamp: 1794876049243,
        },
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [149.127306, -35.29885] },
            properties: {
              id: '1377004279',
              gid: 'whosonfirst:locality:1377004279',
              layer: 'locality',
              source: 'whosonfirst',
              source_id: '1377004279',
              country_code: 'AU',
              name: 'Canberra',
              accuracy: 'centroid',
              country: 'Australia',
              country_gid: 'whosonfirst:country:85632793',
              country_a: 'AUS',
              region: 'Australian Capital Territory',
              region_gid: 'whosonfirst:region:85681493',
              region_a: 'ACT',
              localadmin: 'City',
              localadmin_gid: 'whosonfirst:localadmin:404549959',
              locality: 'Canberra',
              locality_gid: 'whosonfirst:locality:1377004279',
              continent: 'Oceania',
              continent_gid: 'whosonfirst:continent:102191583',
              label: 'Canberra, ACT, Australia',
            },
            bbox: [148.995921617, -35.480332289, 149.268147403, -35.139502997],
          },
        ],
        bbox: [148.995921617, -35.480332289, 149.268147403, -35.139502997],
      },
    },
  },
  {
    // Ashby: a GraphQL query, POSTed with the words in its variables.
    kind: 'place',
    asked: graphqlVariable('jobs.ashbyhq.com', '/api/non-user-graphql', 'ApiAutocompleteGeoLocation', 'text'),
    answers: {
      Canberra: {
        data: {
          result: {
            suggestions: [
              ashbyGeoLocation('Canberra, Australian Capital Territory, Australia', 'Australian Capital Territory', 'canberra'),
              ashbyGeoLocation('Canberra Central, Australian Capital Territory, Australia', 'Australian Capital Territory', 'canberra_central'),
            ],
            __typename: 'AutocompleteLocationResult',
          },
        },
      },
    },
  },
  {
    // Moka (app.mokahr.com): a GET per pause in typing, searchKey the words. Saved on the live page on 2026-11-21
    // (live-check --save-searches, every write blocked) for the sample resume's schools.
    kind: 'school',
    asked: getParam('app.mokahr.com', '/api/schools/searchV2', 'searchKey'),
    answers: {
      '浙江大学': [
        {
          "id": "008ae5fdf8ef9364488ab183708a654f",
          "name": "浙江大学",
          "englishName": "Zhejiang University",
          "tags": [
            "双一流",
            "中国大陆"
          ]
        },
        {
          "id": "0507327fdf8761c61fd9ab820b19ceca",
          "name": "浙江大学医学院",
          "englishName": "Zhejiang University School of Medicine",
          "tags": [
            "中国大陆",
            "双一流-大学"
          ]
        },
        {
          "id": "1aae244c703e6bc250b65fa15379dd6c",
          "name": "浙江大学远程教育学院",
          "englishName": "",
          "tags": []
        },
        {
          "id": "992918f6bfa78f86ebc706838f52088f",
          "name": "浙大城市学院",
          "englishName": "Hangzhou City University",
          "tags": [
            "CDIO工程教育联盟",
            "公办"
          ]
        },
        {
          "id": "0171b0470a703aede5491035261f3677",
          "name": "浙大宁波理工学院",
          "englishName": "Ningbo Tech University",
          "tags": [
            "公办",
            "中国大陆"
          ]
        }
      ],
      '澳大利亚国立大学': [
        {
          "id": "605c5806339e128e4129645a3a71c14d",
          "name": "澳大利亚国立大学",
          "englishName": "The Australian National University (ANU）",
          "tags": [
            "2021年USNEWS排名_69",
            "2021年QS排名_31"
          ]
        },
        {
          "id": "61338ae07787ee34dbbbb94ae9b5ca11",
          "name": "澳大利亚国立大学商学院",
          "englishName": "",
          "tags": [
            "海外院校"
          ]
        }
      ],
    },
  },
  {
    // Moka's major search, saved the same way. It has no major called 计算机科学 and offers the nearest one.
    kind: 'major',
    asked: getParam('app.mokahr.com', '/api/majors/search', 'searchKey'),
    answers: {
      '计算机科学与技术': [
        {
          "name": "计算机科学与技术",
          "englishName": "Computer Science & Technology"
        }
      ],
      '计算机科学': [
        {
          "name": "计算机科学与技术",
          "englishName": "Computer Science & Technology"
        }
      ],
    },
  },
  {
    // Feishu recruiting (德赛西威's portal): a POST per pause in typing, the words at query, entity_type 1 for
    // schools. Saved on the live page on 2026-11-21 (live-check --save-searches, every write blocked) for the sample
    // resume's first school. The answer is kept as the site sent it, results as JSON inside JSON.
    kind: 'school',
    asked: postJsonField('yesv-desaysv.jobs.feishu.cn', '/api/v1/info_session/suggestion/', ['query'], { portal_entrance: 1 }),
    answers: {
      '浙江大学': "{\"code\":0,\"data\":{\"response_list\":[{\"code\":0,\"entitys\":[{\"entity_id\":\"c046026c-d4e6-586d-8148-b815932df980\",\"result\":\"{\\\"entity_id\\\":\\\"c046026cd4e6586d8148b815932df980\\\",\\\"entity_uuid\\\":\\\"c046026c-d4e6-586d-8148-b815932df980\\\",\\\"language\\\":\\\"zh\\\",\\\"name\\\":\\\"浙江大学\\\",\\\"entity_type\\\":\\\"school\\\",\\\"short_name\\\":\\\"浙大、zju\\\",\\\"tags\\\":[\\\"211\\\",\\\"985\\\",\\\"重点院校\\\",\\\"双一流\\\",\\\"first_class_uni\\\",\\\"erben_above\\\",\\\"key_uni\\\",\\\"sanben_above\\\",\\\"yiben_above\\\",\\\"Double first-class\\\",\\\"2026QS200\\\"],\\\"common_name\\\":[],\\\"products\\\":null,\\\"alias\\\":[\\\"浙江大学\\\",\\\"zhejiang university\\\",\\\"浙大\\\",\\\"xixi campus of zhejiang university\\\",\\\"xixicampus\\\",\\\"杭州大学\\\",\\\"zhejianguniversity\\\",\\\"xixi campus\\\",\\\"hangzhouuniversity\\\",\\\"xixicampusofzhejianguniversity\\\",\\\"hangzhou university\\\",\\\"浙江大学西溪校区\\\",\\\"zhejianguniversityzju\\\",\\\"zhejiang university zju\\\"],\\\"ranking\\\":1,\\\"freq\\\":11374,\\\"update_time\\\":1775737792000,\\\"score\\\":227741.47,\\\"status\\\":1,\\\"operator_id\\\":-1,\\\"school_type\\\":\\\"公办\\\",\\\"school_type_zh\\\":\\\"公办\\\",\\\"college_type_zh\\\":\\\"综合\\\",\\\"country\\\":\\\"中国\\\",\\\"city\\\":\\\"杭州\\\",\\\"level_zh\\\":\\\"一本\\\",\\\"level\\\":\\\"\\\",\\\"university_ranking\\\":{\\\"China\\\":3,\\\"Chinese Mainland(Shanghai Ranking)\\\":\\\"3\\\",\\\"QS\\\":45,\\\"World(QS)\\\":\\\"44\\\"},\\\"website\\\":\\\"http://www.zju.edu.cn/\\\",\\\"logo\\\":{\\\"raw\\\":\\\"image/bc420d830d6adad76650781eddb5bbb4.jpg\\\",\\\"1x\\\":\\\"image/bc420d830d6adad76650781eddb5bbb4.jpg\\\",\\\"2x\\\":\\\"image/bc420d830d6adad76650781eddb5bbb4.jpg\\\",\\\"3x\\\":\\\"image/bc420d830d6adad76650781eddb5bbb4.jpg\\\"},\\\"profile\\\":\\\"浙江大学(zhejiang university)，简称“浙大”，是由中华人民共和国教育部直属的综合性全国重点大学，中央直管副部级建制，“双一流”世界一流大学a类建设高校，“211工程”、“985工程”重点建设高校，入选珠峰计划、2011计划、111计划、卓越法律人才教育培养计划、卓越医生教育培养计划、卓越工程师教育培养计划、卓越农林人才教育培养计划、国家级大学生创新创业训练计划、国家大学生创新性实验计划、国家建设高水平大学公派研究生项目、新工科研究与实践项目、中国政府奖学金来华留学生接收院校、全国深化创新创业教育改革示范高校，九校联盟(c9)、环太平洋大学联盟、世界大学联盟、中国大学校长联谊会成员，为中国人自己最早创办的新式高等学校之一，曾被英国著名学者李约瑟称誉为“东方剑桥”。浙江大学的前身求是书院创立于1897年，1928年定名国立浙江大学。抗战期间，浙大举校西迁，在贵州遵义、湄潭等地办学，1946年秋回迁杭州。1952年全国院系调整时，浙江大学部分系科转入中国科学院和其他高校，主体部分在杭州重组为若干所院校，后分别发展为原浙江大学、杭州大学、浙江农业大学和浙江医科大学。1998年，同根同源的四校实现合并，组建了新的浙江大学。在百年的办学历程中，浙江大学始终秉承“求是创新”为校训的优良传统，以天下为己任、以真理为依归，逐步形成了“勤学、修德、明辨、笃实”的浙大人共同价值观和“海纳江河、启真厚德、开物前民、树我邦国”的浙大精神。\\\",\\\"major\\\":[\\\"外科学(普外)\\\",\\\"药物分析学\\\",\\\"肿瘤学\\\",\\\"政治经济学\\\",\\\"光学工程\\\",\\\"环境工程\\\",\\\"计算机软件与理论\\\",\\\"妇产科学\\\",\\\"固体力学\\\",\\\"动力工程及工程热物理\\\",\\\"化学\\\",\\\"数学\\\",\\\"植物学\\\",\\\"中国古典文献学\\\",\\\"病理学与病理生理学\\\",\\\"生物医学工程\\\",\\\"电气工程\\\",\\\"农业资源利用\\\",\\\"理论物理\\\",\\\"生物化工\\\",\\\"外国哲学\\\",\\\"动物营养与饲料科学\\\",\\\"植物保护\\\",\\\"材料科学与工程\\\",\\\"园艺学\\\",\\\"作物遗传育种\\\",\\\"教育史\\\",\\\"控制科学与工程\\\",\\\"化学工程\\\",\\\"儿科学\\\",\\\"生态学\\\",\\\"宪法学与行政法学\\\",\\\"土木工程 \\\",\\\"特种经济动物饲养\\\",\\\"内科学(传染病)\\\",\\\"应用心理学\\\",\\\"农业机械化工程\\\",\\\"生物物理学\\\",\\\"凝聚态物理\\\",\\\"农业经济管理\\\",\\\"眼科学\\\",\\\"通信与信息系统\\\",\\\"管理科学与工程\\\",\\\"机械工程\\\",\\\"计算机应用技术\\\"],\\\"english_name\\\":\\\"Zhejiang University\\\",\\\"source\\\":\\\"bello\\\",\\\"create_time\\\":\\\"2020-02-05 18:54:20\\\",\\\"modify_time\\\":\\\"2026-04-09 20:29:52\\\",\\\"is_current\\\":1}\",\"score\":227741.47},{\"entity_id\":\"b38deec3-b3b7-5882-a22b-012e3c0ab21f\",\"result\":\"{\\\"entity_id\\\":\\\"b38deec3b3b75882a22b012e3c0ab21f\\\",\\\"entity_uuid\\\":\\\"b38deec3-b3b7-5882-a22b-012e3c0ab21f\\\",\\\"language\\\":\\\"zh\\\",\\\"name\\\":\\\"浙江工业大学\\\",\\\"entity_type\\\":\\\"school\\\",\\\"short_name\\\":\\\"浙工大\\\",\\\"tags\\\":[\\\"erben_above\\\",\\\"sanben_above\\\",\\\"yiben_above\\\"],\\\"common_name\\\":[],\\\"products\\\":null,\\\"alias\\\":[\\\"浙江工业大学\\\",\\\"zhejiang university of technology\\\",\\\"浙工大\\\"],\\\"ranking\\\":1,\\\"freq\\\":2895,\\\"update_time\\\":1667225613000,\\\"score\\\":58138.992,\\\"status\\\":1,\\\"operator_id\\\":-1,\\\"school_type\\\":\\\"公办\\\",\\\"school_type_zh\\\":\\\"公办\\\",\\\"college_type_zh\\\":\\\"理工\\\",\\\"country\\\":\\\"中国\\\",\\\"city\\\":\\\"杭州\\\",\\\"level_zh\\\":\\\"一本\\\",\\\"level\\\":\\\"\\\",\\\"university_ranking\\\":{\\\"China\\\":81,\\\"Chinese Mainland(Shanghai Ranking)\\\":\\\"66\\\"},\\\"website\\\":\\\"http://www.zjut.edu.cn\\\",\\\"logo\\\":{\\\"raw\\\":\\\"image/0956b90ec9efab6d91cd03912aa19f1b.jpg\\\",\\\"1x\\\":\\\"image/0956b90ec9efab6d91cd03912aa19f1b.jpg\\\",\\\"2x\\\":\\\"image/0956b90ec9efab6d91cd03912aa19f1b.jpg\\\",\\\"3x\\\":\\\"image/0956b90ec9efab6d91cd03912aa19f1b.jpg\\\"},\\\"profile\\\":\\\"浙江工业大学(zhejiang university of technology)，简称“浙工大”，是中华人民共和国教育部与浙江省人民政府共建的浙江首批省属重点大学，国家“2011计划”首批14所牵头高校，首批“卓越工程师教育培养计划”、“卓越教师培养计划”、“卓越工程师教育培养计划2.0”入选高校，亚洲规划院校联盟(apsa)成员，中国政府奖学金来华留学生接收院校，入选国家“111计划”，国家首批“新工科研究与实践项目”入选高校。对口支持浙江树人大学建设发展，对口支援衢州学院、宁夏理工学院。学校始建于1953年，其前身可以追溯到1910年创立的浙江中等工业学堂，1993年12月由浙江工学院更名为浙江工业大学。2009年6月8日，浙江省人民政府和教育部签订共建协议，浙江工业大学进入省部共建高校行列。2013年5月，学校牵头的“长三角绿色制药协同创新中心”成为全国首批14家2011协同创新中心之一。截至2018年9月，浙江工业大学设朝晖、屏峰、之江三个校区，占地面积3009.92亩，固定资产总值40.77亿元；浙江工业大学德清校区项目规划占地约1000亩，于2017年上半年开工，2019年秋季开学，2017年将基本完成基础施工。图书馆藏书(含电子图书)1028万余册，中外期刊37174种。学校现有66个本科专业，有教职工3048人，其中专任教师2118人，全日制本科学生19159人；在读各类研究生9663人(博士研究生780人，全日制硕士研究生6520人，非全日制硕士研究生2363人)；成人教育学生15600余人；留学生1706人。\\\",\\\"major\\\":[\\\"工业催化\\\"],\\\"english_name\\\":\\\"Zhejiang University of Technology\\\",\\\"source\\\":\\\"bello\\\",\\\"create_time\\\":\\\"2020-02-05 18:54:38\\\",\\\"modify_time\\\":\\\"2022-10-31 22:13:33\\\",\\\"is_current\\\":1}\",\"score\":58138.992},{\"entity_id\":\"74456dc2-3422-581c-a990-4e5faba1c129\",\"result\":\"{\\\"entity_id\\\":\\\"74456dc23422581ca9904e5faba1c129\\\",\\\"entity_uuid\\\":\\\"74456dc2-3422-581c-a990-4e5faba1c129\\\",\\\"language\\\":\\\"zh\\\",\\\"name\\\":\\\"浙江工商大学\\\",\\\"entity_type\\\":\\\"school\\\",\\\"short_name\\\":\\\"浙商大\\\",\\\"tags\\\":[\\\"erben_above\\\",\\\"sanben_above\\\",\\\"yiben_above\\\"],\\\"common_name\\\":[],\\\"products\\\":null,\\\"alias\\\":[\\\"浙江工商大学\\\",\\\"zhejianguniversityofcommerceandindustry\\\",\\\"zhejianggongshanguniversity\\\",\\\"zhejiang gongshang university\\\",\\\"浙商大\\\",\\\"zhejiang university of commerce and industry\\\",\\\"ZJSU\\\",\\\"杭州中等商业学堂\\\",\\\"浙江公立中等商业学校\\\",\\\"浙江省立甲种商业学校\\\",\\\"浙江省立商业学校\\\",\\\"浙江省立商科职业学校\\\",\\\"浙江省立高级商科中学\\\",\\\"浙江省立高级中学（商科）\\\",\\\"浙江省立杭州高级中学（商科）\\\",\\\"浙江省临时联合高级中学（商科）\\\",\\\"浙江省杭州商业学校\\\",\\\"商业部杭州商业学校\\\",\\\"杭州师范学校\\\",\\\"浙江商业学校\\\",\\\"金华婺江商业职业学校\\\"],\\\"ranking\\\":1,\\\"freq\\\":2736,\\\"update_time\\\":1622707841000,\\\"score\\\":54964.336,\\\"status\\\":1,\\\"operator_id\\\":-1,\\\"school_type\\\":\\\"公办\\\",\\\"school_type_zh\\\":\\\"公办\\\",\\\"college_type_zh\\\":\\\"财经\\\",\\\"country\\\":\\\"中国\\\",\\\"city\\\":\\\"杭州\\\",\\\"level_zh\\\":\\\"一本 / 二本\\\",\\\"level\\\":\\\"\\\",\\\"website\\\":\\\"http://www.hzic.edu.cn\\\",\\\"logo\\\":{\\\"raw\\\":\\\"image/dbda361dde400d589f86906937d9a013.jpg\\\",\\\"1x\\\":\\\"image/dbda361dde400d589f86906937d9a013.jpg\\\",\\\"2x\\\":\\\"image/dbda361dde400d589f86906937d9a013.jpg\\\",\\\"3x\\\":\\\"image/dbda361dde400d589f86906937d9a013.jpg\\\"},\\\"profile\\\":\\\"浙江工商大学(zhejiang gongshang university)，简称“浙商大”，教育部、商务部和浙江省人民政府共建高校，浙江省重点建设大学，全国深化创新创业教育改革示范高校。前身是创建于1911年的杭州中等商业学堂，浙江省新式商业教育之先驱，中国最早创办的商业专门学校之一。1980年经国务院批准成立杭州商学院，2004年经教育部批准更名为浙江工商大学。学校先后隶属于原国家商业部和国内贸易部等中央部委，1998年从原商业部直属院校改为“中央与地方共建，以地方管理为主”。百余年来学校一直秉承商科办学传统，以经济学、管理学学科为主，法学、工学等多学科协调发展，已建设成为一所商科特色鲜明、全国一流的财经类大学。自2008年浙江省开展本科教学业绩考核以来，该校稳居前5位，2016年位列全省高校第2位。该校是浙江省内唯一拥有会计学博士点和全国首批审计专业硕士点的高校，最早获得金融学博士点的高校。在教育部第四轮学科评估中，统计学进入a类学科，工商管理、应用经济学等6个学科进入b类，6个学科名列省属高校首位，评估结果位居浙江省重点建设高校前列。四分之三的学科进入全国前50%，全部学科进入全国前60%。统计学是全国财经类大学7个进入学科评估全国前10且进入学科前10%的学科之一。\\\",\\\"english_name\\\":\\\"Zhejiang Gongshang University\\\",\\\"source\\\":\\\"bello\\\",\\\"create_time\\\":\\\"2020-02-05 18:54:38\\\",\\\"modify_time\\\":\\\"2021-06-03 16:10:41\\\",\\\"is_current\\\":1}\",\"score\":54964.336},{\"entity_id\":\"edccffc4-0640-5c74-a500-34a045e5c0c2\",\"result\":\"{\\\"entity_id\\\":\\\"edccffc406405c74a50034a045e5c0c2\\\",\\\"entity_uuid\\\":\\\"edccffc4-0640-5c74-a500-34a045e5c0c2\\\",\\\"language\\\":\\\"zh\\\",\\\"name\\\":\\\"浙江传媒学院\\\",\\\"entity_type\\\":\\\"school\\\",\\\"short_name\\\":\\\"浙传(zjumc)\\\",\\\"tags\\\":[\\\"erben_above\\\",\\\"sanben_above\\\"],\\\"common_name\\\":[],\\\"products\\\":null,\\\"alias\\\":[\\\"浙江传媒\\\",\\\"zhejiang institute of media\\\",\\\"zhejiangmediacollege\\\",\\\"浙传zjumc\\\",\\\"浙传(zjumc)\\\",\\\"zhejiang chuan zjumc\\\",\\\"zhejiang media\\\",\\\"communication university of zhejiang\\\",\\\"浙传\\\",\\\"zhejiang chuan (zjumc)\\\",\\\"浙江传媒大学\\\",\\\"浙江传媒学院\\\",\\\"zhejiang media college\\\",\\\"浙江广播电视高等专科学校\\\",\\\"zhejiang radio and television college\\\",\\\"浙江广播电视学校\\\"],\\\"ranking\\\":1,\\\"freq\\\":2400,\\\"update_time\\\":1679553159000,\\\"score\\\":48246.18,\\\"status\\\":1,\\\"operator_id\\\":-1,\\\"school_type\\\":\\\"公办\\\",\\\"school_type_zh\\\":\\\"公办\\\",\\\"college_type_zh\\\":\\\"艺术\\\",\\\"country\\\":\\\"中国\\\",\\\"city\\\":\\\"杭州\\\",\\\"level\\\":\\\"\\\",\\\"website\\\":\\\"http://www.cuz.edu.cn/\\\",\\\"logo\\\":{\\\"raw\\\":\\\"https://sf3-ttcdn-tos.pstatp.com/obj/people-knowledge/logo/b2fba0ee69cc58d6f4c23f96c62c00a2.jpeg\\\",\\\"1x\\\":\\\"https://sf3-ttcdn-tos.pstatp.com/obj/people-knowledge/logo/b2fba0ee69cc58d6f4c23f96c62c00a2.jpeg\\\",\\\"2x\\\":\\\"https://sf3-ttcdn-tos.pstatp.com/obj/people-knowledge/logo/b2fba0ee69cc58d6f4c23f96c62c00a2.jpeg\\\",\\\"3x\\\":\\\"https://sf3-ttcdn-tos.pstatp.com/obj/people-knowledge/logo/b2fba0ee69cc58d6f4c23f96c62c00a2.jpeg\\\"},\\\"profile\\\":\\\"浙江传媒学院是浙江省人民政府和国家广播电视总局共建高校，是一所行业特色鲜明的高水平传媒类高校，素有“北有北广、南有浙广”“北有中传、南有浙传”之美誉。2004年9月8日，时任浙江省委书记的习近平同志莅临学校考察指导，提出了“紧跟时代、突出特色”的殷切希望。学校从1978年创办浙江广播电视学校、1984年创办浙江广播电视专科学校、2000年两校合并成立新的浙江广播电视高等专科学校、2004年升格为浙江传媒学院，已有42年办学历史。现有杭州下沙和桐乡乌镇两个校区，占地1305亩，总建筑面积57.7万平方米。设有16个二级学院（部、中心），现有在校生14000余人，其中研究生220人；教职员工约1400人，其中专任教师939人。荣获“全国文明单位”“国家级语言文字规范化示范学校”“浙江省平安校园”“浙江省应用型建设试点示范学校”等称号。\\\\n学校学科涵盖艺术学、文学、工学、管理学、经济学等5大学科门类，形成了优势突显、特色鲜明、基础扎实的学科专业体系。有戏剧与影视学、新闻传播学、信息与通信工程3个省一流学科，其中新闻传播学2011年获批1个“服务国家特殊需求人才培养项目（新闻与传播专业硕士）”硕士学位授权点。有41个本科专业，其中艺术类专业18个，播音与主持艺术、广播电视编导为国家特色专业，播音与主持艺术、广播电视编导、广播电视工程、广播电视学为省优势专业，影视摄影与制作、动画、文化产业管理、摄影、网络与新媒体、戏剧影视文学、数字媒体技术为省特色专业。\\\\n学校专任教师中有正高147人、副高282人。有“长江学者”1人，国家“万人计划”1人，“新世纪百千万人才工程”1人，教育部“新世纪优秀人才”1人，中宣部“四个一批”2人，全国优秀教师2人，享受国务院特殊津贴5人，省“钱江学者”3人，省“151人才工程”35人，省高校中青年学科带头人16人，省优秀教师5人，省教学名师4人，“双师双能型”的行业高端人才50余人。\\\\n学校现有省级科创平台5个、省级科创团队3个。近五年先后获批国家级科研项目74项，其中重点重大项目4项，主持省部级科研项目200多项，科研经费总量、高水平论文论著、社会服务与合作实现了跨越式提升。获教育部人文社会科学优秀成果奖、省科学技术进步奖、省哲学社会科学优秀成果奖、省“五个一工程”奖和柏林电影节银熊奖、电影金鸡奖、中国电视剧飞天奖、中国国际电视节白玉兰奖、德国红点设计奖至尊奖、茅盾文学新人奖等40余项。建有全国首个网络文学院。主创了一大批有影响的影视作品，如《长江图》《小鸡彩虹》《孤山路31号》《罗曼蒂克消亡史》《小别离》《小欢喜》《大国通道》《爱上中国》《为了人民的健康》《明月前身》《盖世武生》《七把枪》《启航》等。\\\\n学校现有国家级教学平台2个、省级教学平台11个、省级教学团队4个。近五年来先后获省级教学成果奖4项，承担省教育教学改革项目59项，出版国家级规划教材4部、省级教材14部，主持省级精品在线课程9门。建有360余个产学研实践教学基地，其中国家级大学生校外实践教育基地1个、省级大学生校外实践教育基地5个、海外实习基地5个。荣获全国优秀教师、全国微课大赛、省级优秀教师、省教学技能比赛等荣誉。先后以优异成绩通过了教育部的“本科教学合格评估”和“本科教学审核评估”。思想政治教育引领潮头，2015年被中组部列为首批“全国党员教育培训示范基地”，《不忘初心学党章》《做合格党员》《新时代奋斗指南》《浙水哪得清如许》等获中组部全国党员教育电视片最高奖，原创大型舞台音乐剧《红船往事》获浙江省第十四届精神文明建设“五个一工程”奖。创新创业教育走在前列，2018年5月学校创业学院荣获“浙江省普通高校示范性创业学院”称号，2019年10月传媒文化创意产业园获“浙江省科技企业孵化器”平台资质。\\\\n学校学生近五年来荣获各类国家级项目95项，获省级学科竞赛以上奖励近500项，每年毕业生就业率在95%以上，考研率在15%以上，一年后创业率在5%以上，毕业生职业发展和人才培养质量居全省高校前列，获教育部“全国毕业生就业典型经验高校”称号。众多毕业生成为新闻出版、影视行业、文化产业、文化传播等领域的骨干精英，涌现了一大批如忠诚、章伟秋、龙丹妮、席文、李维嘉、郁刚、朱丹、王志强、林旭坚、林江国、戚薇等知名校友，其中71人次获长江韬奋奖、金话筒奖、中国新闻奖等行业最高奖，《中国好声音》《中国梦想秀》《快乐大本营》《最强大脑》《奔跑吧兄弟》《王牌对王牌》等品牌栏目均由我校毕业生主创。\\\\n学校与美国、英国、日本、澳大利亚、新西兰等国家及港澳台地区近80所高校开展交流合作，每年向包括美国哥伦比亚大学、美国密苏里大学、加拿大多伦多大学、英国伦敦政治经济学院、美国加州大学洛杉矶分校、澳大利亚新南威尔士大学等在内的合作院校派出近300名交流生，现有在校留学生245人，每年聘用国（境）外教师30余人。2015年与英国考文垂大学合作“服装与服饰设计专业本科教育项目”；2017年与英国博尔顿大学合作“视觉传媒硕士学位教育项目”； 2019年与美国纽约州立大学石溪分校联合开展“全球运营管理（大数据方向）”双硕士培养项目。学校还与美国密苏里大学、英国考文垂大学和韩国光州女子大学等国外院校开展双学士联合培养项目。2019年学校获批“国家语言文字推广基地”“教育部国际人文交流与传媒人才培养基地”“浙江省对台交流基地”。\\\\n学校教学仪器设备总值4.22亿元。建有国家级实验教学示范中心1个，国家广播电视总局实验室1个，省重点实验室1个，省级实验教学示范中心7个，省级虚拟仿真实验教学中心1个。学校图书馆馆藏纸质图书165.6万余册，电子图书158.5万余册，电子期刊82.7万余册，学位论文605.8万余册，音视频3919小时。\\\\n学校秉承“敬业、博学、求真、创新”的校训，本着立足浙江、面向全国、紧贴传媒、服务社会的宗旨，力争成为卓越名校、传媒名镇、艺术名片，为迈向国内一流、国际知名的高水平传媒大学而努力奋斗！\\\",\\\"english_name\\\":\\\"Communication University of Zhejiang\\\",\\\"source\\\":\\\"bello\\\",\\\"create_time\\\":\\\"2020-02-05 18:54:17\\\",\\\"modify_time\\\":\\\"2023-03-23 14:32:39\\\",\\\"is_current\\\":1}\",\"score\":48246.18},{\"entity_id\":\"66e5abc7-b2fa-5a13-a800-2c80944ed4e8\",\"result\":\"{\\\"entity_id\\\":\\\"66e5abc7b2fa5a13a8002c80944ed4e8\\\",\\\"entity_uuid\\\":\\\"66e5abc7-b2fa-5a13-a800-2c80944ed4e8\\\",\\\"language\\\":\\\"zh\\\",\\\"name\\\":\\\"浙江理工大学\\\",\\\"entity_type\\\":\\\"school\\\",\\\"short_name\\\":\\\"浙理工(zstu)\\\",\\\"tags\\\":[\\\"erben_above\\\",\\\"sanben_above\\\",\\\"yiben_above\\\"],\\\"common_name\\\":[],\\\"products\\\":null,\\\"alias\\\":[\\\"浙江理工大学\\\",\\\"浙江丝绸工学院\\\",\\\"zhejiang institute of silk\\\",\\\"zhejiang polytechnic\\\",\\\"zhejiang institute of technology (zstu)\\\",\\\"浙理工\\\",\\\"zhejianginstituteofsilk\\\",\\\"浙理工(zstu)\\\",\\\"zhejiang sci-tech university\\\",\\\"zhejianginstituteoftechnology(zstu)\\\",\\\"institutesoftechnologyofzhejiang\\\",\\\"zhejiangscienceandtechnology(zstu)\\\",\\\"zhejiang institute of technology\\\",\\\"institutes of technology of zhejiang\\\",\\\"zhejiang science and technology (zstu)\\\",\\\"zhejiangpolytechnic\\\",\\\"zhejianginstituteoftechnology\\\",\\\"zhejiang silk institute of technology\\\",\\\"zhejiangsilkinstituteoftechnology\\\",\\\"zhejiangsci-techuniversity\\\",\\\"zhejiang scitech university\\\",\\\"zhejiangscitechuniversity\\\"],\\\"ranking\\\":1,\\\"freq\\\":2142,\\\"update_time\\\":1673849219000,\\\"score\\\":43083.26,\\\"status\\\":1,\\\"operator_id\\\":-1,\\\"school_type\\\":\\\"公办\\\",\\\"school_type_zh\\\":\\\"公办\\\",\\\"college_type_zh\\\":\\\"理工\\\",\\\"country\\\":\\\"中国\\\",\\\"city\\\":\\\"杭州\\\",\\\"level_zh\\\":\\\"一本\\\",\\\"level\\\":\\\"\\\",\\\"university_ranking\\\":{\\\"China\\\":111,\\\"Chinese Mainland(Shanghai Ranking)\\\":\\\"112\\\"},\\\"website\\\":\\\"http://www.zstu.edu.cn\\\",\\\"logo\\\":{\\\"raw\\\":\\\"https://sf3-ttcdn-tos.pstatp.com/obj/people-knowledge/logo/520a115055b7ae7b170acb1b20b3aef4.png\\\",\\\"1x\\\":\\\"https://sf3-ttcdn-tos.pstatp.com/obj/people-knowledge/logo/520a115055b7ae7b170acb1b20b3aef4.png\\\",\\\"2x\\\":\\\"https://sf3-ttcdn-tos.pstatp.com/obj/people-knowledge/logo/520a115055b7ae7b170acb1b20b3aef4.png\\\",\\\"3x\\\":\\\"https://sf3-ttcdn-tos.pstatp.com/obj/people-knowledge/logo/520a115055b7ae7b170acb1b20b3aef4.png\\\"},\\\"profile\\\":\\\"浙江理工大学(zhejiang  sci-tech  university)，简称“浙理工”，是一所以工为主，特色鲜明，优势突出，理、工、文、经、管、法、艺术、教育等多学科协调发展的省属重点建设大学。学校坐落于“上有天堂，下有苏杭”的历史文化名城杭州市。入选”中国政府奖学金来华留学生接收院校“、教育部“卓越工程师教育培养计划“、教育部“卓越工程师教育培养计划2.0”、国家“新工科研究与实践项目”。浙江理工大学办学历史可追溯到1897年杭州知府林启为实现其实业救国、教育救国而创办的浙江蚕学馆，是中国最早创办的新学教育机构之一。1959年开始招收本科生，1964年由国务院定名为浙江丝绸工学院，1979年开始招收硕士研究生，1983年获硕士学位授予权。1999年，经教育部批准，学校更名为浙江工程学院。2004年，经教育部批准，学校更名为浙江理工大学。2006年获得博士学位授予权。材料科学、化学、工程学等三个学科保持全球esi排名前1%。截至2018年9月，学校占地面积2100余亩。下设17个学院(教研部)，举办1所独立学院，有本科专业65个；拥有博士学位授权一级学科3个，硕士学位授权一级学科26个，专业学位类别10种，博士后科研流动站2个；3个学科进入esi全球排名前1%；有全日制在校学生27000余人，其中研究生3800余人、留学生400余人；教职工2000余人，其中具有副高以上职称880余人，正高职称270余人。\\\",\\\"english_name\\\":\\\"Zhejiang Sci-Tech University\\\",\\\"source\\\":\\\"bello\\\",\\\"create_time\\\":\\\"2020-02-05 18:54:23\\\",\\\"modify_time\\\":\\\"2023-01-16 14:06:59\\\",\\\"is_current\\\":1}\",\"score\":43083.26},{\"entity_id\":\"40de7afe-b131-5c85-8672-c9f363f32e2a\",\"result\":\"{\\\"entity_id\\\":\\\"40de7afeb1315c858672c9f363f32e2a\\\",\\\"entity_uuid\\\":\\\"40de7afe-b131-5c85-8672-c9f363f32e2a\\\",\\\"language\\\":\\\"zh\\\",\\\"name\\\":\\\"浙江财经大学\\\",\\\"entity_type\\\":\\\"school\\\",\\\"short_name\\\":\\\"浙财大、浙财(zufe)\\\",\\\"tags\\\":[\\\"erben_above\\\",\\\"sanben_above\\\",\\\"yiben_above\\\"],\\\"common_name\\\":[],\\\"products\\\":null,\\\"alias\\\":[\\\"zhejiang university of finance economics\\\",\\\"zhejiang university of finance and economics\\\",\\\"浙江财经大学\\\",\\\"zhejianguniversityoffinance\\\",\\\"zhejianguniversityoffinanceeconomics\\\",\\\"浙江财经学院\\\",\\\"zhejianguniversityoffinanceandeconomics\\\",\\\"zhejiang university of finance\\\",\\\"浙财大\\\",\\\"浙财\\\",\\\"ZUFE\\\",\\\"浙江财政银行学校\\\",\\\"浙江财政专科学校\\\"],\\\"ranking\\\":1,\\\"freq\\\":1238,\\\"update_time\\\":1622708031000,\\\"score\\\":25013.803,\\\"status\\\":1,\\\"operator_id\\\":-1,\\\"school_type\\\":\\\"公办\\\",\\\"school_type_zh\\\":\\\"公办\\\",\\\"college_type_zh\\\":\\\"财经\\\",\\\"country\\\":\\\"中国\\\",\\\"city\\\":\\\"杭州\\\",\\\"level_zh\\\":\\\"一本\\\",\\\"level\\\":\\\"\\\",\\\"website\\\":\\\"http://www.zufe.edu.cn\\\",\\\"logo\\\":{\\\"raw\\\":\\\"image/33410b235fea869ededb002a4b8c44ec.jpg\\\",\\\"1x\\\":\\\"image/33410b235fea869ededb002a4b8c44ec.jpg\\\",\\\"2x\\\":\\\"image/33410b235fea869ededb002a4b8c44ec.jpg\\\",\\\"3x\\\":\\\"image/33410b235fea869ededb002a4b8c44ec.jpg\\\"},\\\"profile\\\":\\\"浙江财经大学(zhejiang university of finance  economics)坐落在浙江省杭州市，是一所由浙江省人民政府举办的，中国高等教育学会创新创业教育分会会员单位，以经济、管理学科为主体，多学科协调发展的全日制普通高等学校，入选第二批浙江省重点建设高校，具有博士、硕士、学士学位授予权和外国留学生、港澳台学生招生权。毕业生薪酬水平位列全国第75位浙江省属高校第一。浙江财经大学前身是创建于1974年的浙江财政银行学校；1978年，浙江财政银行学校分设后成立浙江财政学校；1984年筹建浙江财经学院，筹建期间称浙江财政专科学校；1987年成立浙江财经学院；2013年更名为浙江财经大学。截至2018年6月，浙江财经大学共有下沙、文华、翠苑和长安4个校区，占地2300亩，总建筑面积98.5万平方米；固定资产总值16.87亿元，其中教学科研仪器设备值1.6亿元；建有16个二级学院，1个教学部，1个独立学院，3个研究院，开设有45个本科专业；共有全日制在校学生25000余人(含独立学院)，教职工1492人，其中专任教师1080人。\\\",\\\"english_name\\\":\\\"Zhejiang University of Finance and Economics\\\",\\\"source\\\":\\\"bello\\\",\\\"create_time\\\":\\\"2020-02-05 18:54:38\\\",\\\"modify_time\\\":\\\"2021-06-03 16:13:51\\\",\\\"is_current\\\":1}\",\"score\":25013.803},{\"entity_id\":\"0ec35a14-1227-5717-8dc8-f22cef4e9414\",\"result\":\"{\\\"entity_id\\\":\\\"0ec35a14122757178dc8f22cef4e9414\\\",\\\"entity_uuid\\\":\\\"0ec35a14-1227-5717-8dc8-f22cef4e9414\\\",\\\"language\\\":\\\"zh\\\",\\\"name\\\":\\\"浙江师范大学\\\",\\\"entity_type\\\":\\\"school\\\",\\\"short_name\\\":\\\"浙师大\\\",\\\"tags\\\":[\\\"erben_above\\\",\\\"sanben_above\\\",\\\"yiben_above\\\"],\\\"common_name\\\":[],\\\"products\\\":null,\\\"alias\\\":[\\\"浙江师范大学\\\",\\\"zhejiangnormaluniversity\\\",\\\"浙师大\\\",\\\"zhejiang normal university\\\"],\\\"ranking\\\":1,\\\"freq\\\":1043,\\\"update_time\\\":1667224859000,\\\"score\\\":21104.033,\\\"status\\\":1,\\\"operator_id\\\":-1,\\\"school_type\\\":\\\"公办\\\",\\\"school_type_zh\\\":\\\"公办\\\",\\\"college_type_zh\\\":\\\"师范\\\",\\\"country\\\":\\\"中国\\\",\\\"city\\\":\\\"金华\\\",\\\"level_zh\\\":\\\"一本 / 二本\\\",\\\"level\\\":\\\"\\\",\\\"university_ranking\\\":{\\\"China\\\":104,\\\"Chinese Mainland(Shanghai Ranking)\\\":\\\"98\\\"},\\\"website\\\":\\\"http://www.zjnu.edu.cn/\\\",\\\"logo\\\":{\\\"raw\\\":\\\"https://sf3-ttcdn-tos.pstatp.com/obj/people-knowledge/logo/f68b85638d123c1db44d18b7a61e2edc.png\\\",\\\"1x\\\":\\\"https://sf3-ttcdn-tos.pstatp.com/obj/people-knowledge/logo/f68b85638d123c1db44d18b7a61e2edc.png\\\",\\\"2x\\\":\\\"https://sf3-ttcdn-tos.pstatp.com/obj/people-knowledge/logo/f68b85638d123c1db44d18b7a61e2edc.png\\\",\\\"3x\\\":\\\"https://sf3-ttcdn-tos.pstatp.com/obj/people-knowledge/logo/f68b85638d123c1db44d18b7a61e2edc.png\\\"},\\\"profile\\\":\\\"浙江师范大学(zhejiang normal university)是一所以教师教育为主的多科性省属重点大学，是浙江省重点建设高校，入选“卓越教师培养计划”、“111计划”、“中国政府奖学金来华留学生接收院校”、“浙江省十佳对外合作单位”、“浙江省国际化特色高校”建设单位，建有浙江省唯一的教育学一级学科重点研究基地。前身为杭州师范专科学校，创建于1956年，1958年升格为杭州师范学院。1962年，杭州师范学院与浙江教育学院、浙江体育学院合并，更名为浙江师范学院。1965年，浙江师范学院从杭州搬迁至金华。1980年被列为省属重点高校。1985年更名为浙江师范大学。2000年、2001年、2004年浙江财政学校、浙江幼儿师范学校和金华铁路司机学校相继并入。2015年入选浙江省首批重点建设高校。对口支援衢州学院，与金华市委市政府共建金华理工学院。截至2018年8月，浙江师范大学由金华(校本部)、杭州(文二校区、萧山校区)、兰溪3个校区，18个学院(含独立学院浙江师范大学行知学院)组成；有全日制本(专)科生25000余人(含独立学院学生)，研究生6000余人，留学生近3000人(规模居省属高校第一)，各类成人高等学历教育学生近2万人；有71个本科专业，8个一级学科博士点，1个专业博士学位授权点，27个一级学科硕士点，11个专业硕士学位类别，2个博士后流动站；4个学科进入esi全球前1%。20个学科列入浙江省一流学科；建成附属中学19所。\\\",\\\"english_name\\\":\\\"Zhejiang Normal University\\\",\\\"source\\\":\\\"bello\\\",\\\"create_time\\\":\\\"2020-02-05 18:54:38\\\",\\\"modify_time\\\":\\\"2022-10-31 22:00:59\\\",\\\"is_current\\\":1}\",\"score\":21104.033}],\"BaseResp\":{\"StatusMessage\":\"success\",\"StatusCode\":0,\"Extra\":null}}],\"BaseResp\":{\"StatusMessage\":\"\",\"StatusCode\":0,\"Extra\":null}},\"message\":\"ok\",\"error\":null}",
    },
  },
];

/** The answer one of these services gave on the live page to this request, or null when there is none. */
export function answerFrom(services: SearchService[], request: SearchRequest): SearchAnswer | null {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  for (const service of services) {
    const words = service.asked(request, url);
    if (words === null) continue;
    if (!Object.hasOwn(service.answers, words)) return null;
    const saved = service.answers[words];
    return { contentType: service.contentType ?? JSON_TYPE, body: typeof saved === 'string' ? saved : JSON.stringify(saved) };
  }
  return null;
}

/** The service's recorded answer to this request, or null when there is none. */
export function searchAnswer(request: SearchRequest): SearchAnswer | null {
  return answerFrom(SERVICES, request);
}

/** Call after the recording's own route, so this one is asked first. What it cannot answer goes on to the recording. */
export async function answerSearches(context: BrowserContext): Promise<void> {
  await context.route(/^https?:\/\//, (route) => {
    const request = route.request();
    const answer = searchAnswer({ method: request.method(), url: request.url(), postData: request.postData() });
    if (!answer) return route.fallback();
    // The page and the service sit on different hosts for Greenhouse, so the answer has to allow the page.
    const origin = request.headers()['origin'];
    return route.fulfill({
      status: 200,
      contentType: answer.contentType,
      headers: origin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' } : {},
      body: answer.body,
    });
  });
}
