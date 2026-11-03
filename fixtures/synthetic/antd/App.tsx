import { useLayoutEffect, type ReactNode } from 'react';
import { Button, Card, Cascader, Checkbox, ConfigProvider, DatePicker, Form, Input, Radio, Select, Upload } from 'antd';
import zhCN from 'antd/es/locale/zh_CN';
import {
  AWARD_LEVELS, CITIES, DEGREES, ENGLISH_LEVELS, ETHNICITIES, FOREIGN_LANGUAGES, PHONE_CODES, POLITICAL,
  REGIONS_2, REGIONS_3, SCHOOLS,
} from './data';
import { bindFixtureForm } from './fixtureState';

const { TextArea } = Input;
const PICK = '请选择';
const gap = { marginBottom: 16 } as const;

/** Inner card for one repeated entry (education / internship / award). */
function Entry({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card type="inner" title={title} style={{ marginBottom: 12 }}>
      {children}
    </Card>
  );
}

export function App() {
  const [form] = Form.useForm();
  useLayoutEffect(() => {
    bindFixtureForm(form);
    return () => bindFixtureForm(null);
  }, [form]);

  return (
    <ConfigProvider locale={zhCN}>
      <div style={{ maxWidth: 760, margin: '24px auto', padding: '0 16px' }}>
        <h1>校园招聘 · 简历投递</h1>
        <Form
          form={form}
          name="application"
          layout="vertical"
          autoComplete="off"
          initialValues={{ education: [{}], internship: [{}, {}], award: [{}] }}
        >
          <Card title="基本信息" style={gap}>
            <Form.Item label="姓名" name="name">
              <Input placeholder="请输入姓名" />
            </Form.Item>
            <Form.Item label="性别" name="gender">
              <Radio.Group>
                <Radio value="男">男</Radio>
                <Radio value="女">女</Radio>
              </Radio.Group>
            </Form.Item>
            <Form.Item label="出生日期" name="birthDate">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="民族" name="ethnicity">
              <Select showSearch placeholder={PICK} options={ETHNICITIES} />
            </Form.Item>
            <Form.Item label="政治面貌" name="politicalStatus">
              <Select placeholder={PICK} options={POLITICAL} />
            </Form.Item>
            <Form.Item label="手机号码" name="phone">
              <Input
                placeholder="请输入手机号码"
                addonBefore={
                  <Form.Item name="phoneCountryCode" noStyle>
                    <Select placeholder="区号" options={PHONE_CODES} style={{ width: 90 }} />
                  </Form.Item>
                }
              />
            </Form.Item>
            <Form.Item label="电子邮箱" name="email">
              <Input placeholder="请输入电子邮箱" />
            </Form.Item>
            <Form.Item label="身份证号" name="idNumber">
              <Input placeholder="请输入身份证号" />
            </Form.Item>
            <Form.Item label="微信号" name="wechat">
              <Input placeholder="请输入微信号" />
            </Form.Item>
            <Form.Item label="QQ" name="qq">
              <Input placeholder="请输入QQ号" />
            </Form.Item>
            <Form.Item label="籍贯" name="nativePlace">
              <Cascader options={REGIONS_2} placeholder={PICK} />
            </Form.Item>
            <Form.Item label="现居住地" name="currentLocation">
              <Cascader options={REGIONS_3} placeholder={PICK} />
            </Form.Item>
          </Card>

          <Card title="求职意向" style={gap}>
            <Form.Item label="期望职位" name="expectedPosition">
              <Input placeholder="请输入期望职位" />
            </Form.Item>
            <Form.Item label="期望城市" name="expectedCities">
              <Select mode="multiple" placeholder={PICK} options={CITIES} />
            </Form.Item>
            <Form.Item label="是否服从调剂" name="acceptAdjustment">
              <Radio.Group>
                <Radio value="是">是</Radio>
                <Radio value="否">否</Radio>
              </Radio.Group>
            </Form.Item>
          </Card>

          <Card title="教育经历" style={gap}>
            <Form.List name="education">
              {(fields, { add }) => (
                <>
                  {fields.map((f, i) => (
                    <Entry key={f.key} title={`教育经历 ${i + 1}`}>
                      <Form.Item label="学校名称" name={[f.name, 'school']}>
                        <Select showSearch placeholder={PICK} options={SCHOOLS} />
                      </Form.Item>
                      <Form.Item label="学历" name={[f.name, 'degree']}>
                        <Select placeholder={PICK} options={DEGREES} />
                      </Form.Item>
                      <Form.Item label="专业" name={[f.name, 'major']}>
                        <Input placeholder="请输入专业" />
                      </Form.Item>
                      <Form.Item label="入学时间" name={[f.name, 'startDate']}>
                        <DatePicker picker="month" style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item label="毕业时间" name={[f.name, 'endDate']}>
                        <DatePicker picker="month" style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item label="GPA" name={[f.name, 'gpa']}>
                        <Input placeholder="请输入GPA" />
                      </Form.Item>
                      <Form.Item label="专业排名" name={[f.name, 'ranking']}>
                        <Input placeholder="如 5/120" />
                      </Form.Item>
                    </Entry>
                  ))}
                  <Button type="dashed" block onClick={() => add({})}>
                    + 添加教育经历
                  </Button>
                </>
              )}
            </Form.List>
          </Card>

          <Card title="实习经历" style={gap}>
            <Form.List name="internship">
              {(fields) => (
                <>
                  {fields.map((f, i) => (
                    <Entry key={f.key} title={`实习经历 ${i + 1}`}>
                      <Form.Item label="公司名称" name={[f.name, 'company']}>
                        <Input placeholder="请输入公司名称" />
                      </Form.Item>
                      <Form.Item label="职位名称" name={[f.name, 'position']}>
                        <Input placeholder="请输入职位名称" />
                      </Form.Item>
                      <Form.Item label="开始时间" name={[f.name, 'startDate']}>
                        <DatePicker picker="month" style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item label="结束时间" name={[f.name, 'endDate']}>
                        <DatePicker picker="month" style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item name={[f.name, 'current']} valuePropName="checked">
                        <Checkbox>至今</Checkbox>
                      </Form.Item>
                      <Form.Item label="工作内容" name={[f.name, 'description']}>
                        <TextArea rows={3} placeholder="请描述工作内容" />
                      </Form.Item>
                    </Entry>
                  ))}
                </>
              )}
            </Form.List>
          </Card>

          <Card title="语言能力" style={gap}>
            <Form.Item label="英语等级" name="englishLevel">
              <Select placeholder={PICK} options={ENGLISH_LEVELS} />
            </Form.Item>
            <Form.Item label="外语语种" name="foreignLanguage">
              <Select placeholder={PICK} options={FOREIGN_LANGUAGES} />
            </Form.Item>
          </Card>

          <Card title="获奖情况" style={gap}>
            <Form.List name="award">
              {(fields) => (
                <>
                  {fields.map((f, i) => (
                    <Entry key={f.key} title={`获奖情况 ${i + 1}`}>
                      <Form.Item label="奖项名称" name={[f.name, 'name']}>
                        <Input placeholder="请输入奖项名称" />
                      </Form.Item>
                      <Form.Item label="获奖时间" name={[f.name, 'date']}>
                        <DatePicker picker="month" style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item label="奖项级别" name={[f.name, 'level']}>
                        <Select placeholder={PICK} options={AWARD_LEVELS} />
                      </Form.Item>
                    </Entry>
                  ))}
                </>
              )}
            </Form.List>
          </Card>

          <Card title="附件" style={gap}>
            <Form.Item
              label="上传简历"
              name="resume"
              valuePropName="fileList"
              getValueFromEvent={(e: { fileList?: unknown[] }) => e?.fileList ?? []}
            >
              <Upload beforeUpload={() => false} maxCount={1} accept=".pdf,.doc,.docx">
                <Button>点击上传</Button>
              </Upload>
            </Form.Item>
          </Card>

          <Card title="自我评价" style={gap}>
            <Form.Item label="自我评价" name="selfEvaluation">
              <TextArea rows={5} placeholder="请输入自我评价" />
            </Form.Item>
          </Card>

          <Card title="其他" style={gap}>
            <Form.Item label="推荐人工号" name="referrerId">
              <Input placeholder="如无请留空" />
            </Form.Item>
          </Card>

          <Button type="primary" htmlType="submit" onClick={(e) => e.preventDefault()}>
            提交申请
          </Button>
        </Form>
      </div>
    </ConfigProvider>
  );
}
