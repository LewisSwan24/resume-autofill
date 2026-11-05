<script setup lang="ts">
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import { onBeforeUnmount, reactive } from 'vue';
import { ACADEMIC_DEGREES, DEGREES, MARITAL, POLITICAL, REGIONS, SCHOOLS } from './data';
import {
  bindFixtureModel,
  type EducationEntry,
  type FamilyRow,
  type FormModel,
  type InternshipEntry,
  type ProjectEntry,
} from './fixtureState';

const newEducation = (): EducationEntry => ({
  school: '',
  degree: '',
  academicDegree: '',
  major: '',
  startDate: '',
  endDate: '',
  schoolOptions: [],
  schoolLoading: false,
});
const newInternship = (): InternshipEntry => ({
  company: '',
  position: '',
  startDate: '',
  endDate: '',
  current: false,
  description: '',
});
const newProject = (): ProjectEntry => ({ name: '', role: '', period: null, description: '' });
const newFamily = (): FamilyRow => ({ relationship: '', name: '', employer: '', position: '' });

const model = reactive<FormModel>({
  name: '',
  gender: '',
  birthMonth: '',
  politicalStatus: '',
  maritalStatus: '',
  phone: '',
  email: '',
  household: [],
  studentOrigin: [],
  education: [newEducation(), newEducation()], // 2 cards preset
  internship: [], // 0 cards; "添加实习经历" appends
  project: [newProject()], // 1 card, no add button
  family: [newFamily(), newFamily()],
  emergencyName: '',
  emergencyPhone: '',
  acceptRelocation: false,
  photo: [],
  selfIntroduction: '',
});
bindFixtureModel(model);
onBeforeUnmount(() => bindFixtureModel(null));

// Remote school search: options start empty and are filled 300 ms after the query changes.
const timers = new WeakMap<EducationEntry, number>();
function searchSchools(entry: EducationEntry, query: string): void {
  window.clearTimeout(timers.get(entry));
  if (!query) {
    entry.schoolOptions = [];
    entry.schoolLoading = false;
    return;
  }
  entry.schoolLoading = true;
  timers.set(
    entry,
    window.setTimeout(() => {
      entry.schoolOptions = SCHOOLS.filter((s) => s.includes(query));
      entry.schoolLoading = false;
    }, 300),
  );
}
</script>

<template>
  <el-config-provider :locale="zhCn">
    <div style="max-width: 960px; margin: 0 auto; padding: 16px">
      <h2>校园招聘网申表</h2>
      <el-form :model="model" label-position="right" label-width="120px">
        <el-card style="margin-bottom: 16px">
          <template #header>基本信息</template>
          <el-form-item label="姓名">
            <el-input v-model="model.name" />
          </el-form-item>
          <el-form-item label="性别">
            <el-radio-group v-model="model.gender">
              <el-radio value="男">男</el-radio>
              <el-radio value="女">女</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="出生年月">
            <el-date-picker v-model="model.birthMonth" type="month" value-format="YYYY-MM" />
          </el-form-item>
          <el-form-item label="政治面貌">
            <el-select v-model="model.politicalStatus" placeholder="请选择">
              <el-option v-for="o in POLITICAL" :key="o" :label="o" :value="o" />
            </el-select>
          </el-form-item>
          <el-form-item label="婚姻状况">
            <el-select v-model="model.maritalStatus" placeholder="请选择">
              <el-option v-for="o in MARITAL" :key="o" :label="o" :value="o" />
            </el-select>
          </el-form-item>
          <el-form-item label="手机">
            <el-input v-model="model.phone" />
          </el-form-item>
          <el-form-item label="邮箱">
            <el-input v-model="model.email" />
          </el-form-item>
          <el-form-item label="户口所在地">
            <el-cascader v-model="model.household" :options="REGIONS" placeholder="请选择" />
          </el-form-item>
          <el-form-item label="生源地">
            <el-cascader v-model="model.studentOrigin" :options="REGIONS" placeholder="请选择" />
          </el-form-item>
        </el-card>

        <el-card style="margin-bottom: 16px">
          <template #header>教育经历</template>
          <el-card v-for="(entry, i) in model.education" :key="i" shadow="never" style="margin-bottom: 12px">
            <template #header>教育经历 {{ i + 1 }}</template>
            <el-form-item label="学校">
              <el-select
                v-model="entry.school"
                filterable
                remote
                :remote-method="(q: string) => searchSchools(entry, q)"
                :loading="entry.schoolLoading"
                placeholder="请输入学校名称"
              >
                <el-option v-for="o in entry.schoolOptions" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="学历">
              <el-select v-model="entry.degree" placeholder="请选择">
                <el-option v-for="o in DEGREES" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="学位">
              <el-select v-model="entry.academicDegree" placeholder="请选择">
                <el-option v-for="o in ACADEMIC_DEGREES" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="专业">
              <el-input v-model="entry.major" />
            </el-form-item>
            <el-form-item label="开始时间">
              <el-date-picker v-model="entry.startDate" type="month" value-format="YYYY-MM" />
            </el-form-item>
            <el-form-item label="结束时间">
              <el-date-picker v-model="entry.endDate" type="month" value-format="YYYY-MM" />
            </el-form-item>
          </el-card>
        </el-card>

        <el-card style="margin-bottom: 16px">
          <template #header>实习经历</template>
          <el-card v-for="(entry, i) in model.internship" :key="i" shadow="never" style="margin-bottom: 12px">
            <template #header>实习经历 {{ i + 1 }}</template>
            <el-form-item label="公司">
              <el-input v-model="entry.company" />
            </el-form-item>
            <el-form-item label="岗位">
              <el-input v-model="entry.position" />
            </el-form-item>
            <el-form-item label="开始时间">
              <el-date-picker v-model="entry.startDate" type="month" value-format="YYYY-MM" />
            </el-form-item>
            <el-form-item label="结束时间">
              <el-date-picker v-model="entry.endDate" type="month" value-format="YYYY-MM" />
            </el-form-item>
            <el-form-item label="是否在职">
              <el-checkbox v-model="entry.current">是</el-checkbox>
            </el-form-item>
            <el-form-item label="工作描述">
              <el-input v-model="entry.description" type="textarea" :rows="3" />
            </el-form-item>
          </el-card>
          <el-button @click="model.internship.push(newInternship())">添加实习经历</el-button>
        </el-card>

        <el-card style="margin-bottom: 16px">
          <template #header>项目经历</template>
          <el-card v-for="(entry, i) in model.project" :key="i" shadow="never">
            <template #header>项目经历 {{ i + 1 }}</template>
            <el-form-item label="项目名称">
              <el-input v-model="entry.name" />
            </el-form-item>
            <el-form-item label="担任角色">
              <el-input v-model="entry.role" />
            </el-form-item>
            <el-form-item label="起止时间">
              <el-date-picker v-model="entry.period" type="monthrange" value-format="YYYY-MM" />
            </el-form-item>
            <el-form-item label="项目描述">
              <el-input v-model="entry.description" type="textarea" :rows="3" />
            </el-form-item>
          </el-card>
        </el-card>

        <el-card style="margin-bottom: 16px">
          <template #header>家庭成员</template>
          <table class="family-table">
            <thead>
              <tr>
                <th>关系</th>
                <th>姓名</th>
                <th>工作单位</th>
                <th>职务</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in model.family" :key="i">
                <td><el-input v-model="row.relationship" /></td>
                <td><el-input v-model="row.name" /></td>
                <td><el-input v-model="row.employer" /></td>
                <td><el-input v-model="row.position" /></td>
              </tr>
            </tbody>
          </table>
        </el-card>

        <el-card style="margin-bottom: 16px">
          <template #header>紧急联系人</template>
          <el-form-item label="姓名">
            <el-input v-model="model.emergencyName" />
          </el-form-item>
          <el-form-item label="电话">
            <el-input v-model="model.emergencyPhone" />
          </el-form-item>
        </el-card>

        <el-card style="margin-bottom: 16px">
          <template #header>其他信息</template>
          <el-form-item label="是否接受外派">
            <el-checkbox v-model="model.acceptRelocation">是</el-checkbox>
          </el-form-item>
          <el-form-item label="照片">
            <el-upload v-model:file-list="model.photo" :auto-upload="false" accept="image/*">
              <el-button>选择照片</el-button>
            </el-upload>
          </el-form-item>
          <el-form-item label="自我介绍">
            <el-input v-model="model.selfIntroduction" type="textarea" :rows="4" />
          </el-form-item>
        </el-card>
      </el-form>
    </div>
  </el-config-provider>
</template>

<style>
.family-table {
  width: 100%;
  border-collapse: collapse;
}
.family-table th,
.family-table td {
  padding: 4px 8px;
  text-align: left;
}
</style>
