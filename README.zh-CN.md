# Resume Autofill（网申简历一键填写助手）

[English](README.md) | **简体中文**

本地优先的网申简历一键填写 Chrome 扩展，覆盖中国校招网站，也覆盖澳洲和海外的 ATS 平台。

技术栈：WXT 0.21、React 19、TypeScript（Manifest V3）。

## 核心特性

- **一键填写。** 在网申页面点右下角的悬浮按钮，扩展按你选定的简历填好表单。
- **绝不瞎填。** 没把握的字段保持留空，并标成黄色等你确认。验证码、同意隐私条款的复选框这类字段一律不碰。
- **填写报告。** 按钮旁弹出摘要卡片，侧边栏按严重程度列出每个字段。可以采纳候选项，也可以手动改写。
- **数据完全本地。** 简历、附件和设置都存在本机的 `chrome.storage.local` 和 IndexedDB 里。
- **只给每个 frame 需要的数据。** 后台先问每个 frame 识别到了哪些字段（这一步不带简历数据），再只发对应的值。没有表单的 frame，例如第三方 iframe，什么都收不到。
- **支持 iframe 和多组件库。** 可以跨 iframe 填写，能驱动原生 HTML 控件、Ant Design 和 Element Plus 组件。
- **中英双语简历。** 每种语言维护一份简历，例如 zh-CN 和 en-AU，在侧边栏切换当前使用的那份。界面本身也有中文和英文两种。

## 当前状态与路线图

| 里程碑 | 内容 | 状态 |
|---|---|---|
| **M1** | 核心引擎、简历编辑器、侧边栏和悬浮按钮。在合成测试站（原生 HTML、Ant Design、Element Plus）上，字段 100% 填对。 | 已完成 |
| **M2** | 适配真实 ATS：Workday、SuccessFactors、PageUp、Greenhouse、Lever、Moka、北森、飞书招聘等。 | 计划中 |
| **M3** | 加入 AI 能力：简历导入、开放题起草、中英互译、投递工作台，同时完善文件上传并做整体打磨。 | 计划中 |

## 安装

需要 Node.js、pnpm，以及 Chrome 114 及以上（侧边栏 API 的要求）。

```powershell
pnpm i
pnpm build        # 产物在 .output/chrome-mv3
```

然后加载到 Chrome：

1. 地址栏打开 `chrome://extensions`。
2. 打开右上角的「开发者模式」。
3. 点「加载已解压的扩展程序」，选择 `.output/chrome-mv3` 目录。
4. 再次 `pnpm build` 之后，点扩展卡片上的刷新按钮即可更新。

首次安装时，扩展会写入两份示例简历：`林知远（中文简历）`（zh-CN）和 `Zhiyuan (Leo) Lin (English resume)`（en-AU）。

## 本地试用

仓库自带合成网申页面，分别对应三套界面技术栈。

```powershell
pnpm fixtures:build
pnpm fixtures:preview     # 固定端口 4173
```

打开 <http://localhost:4173/>，选一个页面：

| 页面 | 路径 | 应选用的示例简历 |
|---|---|---|
| 原生 HTML（en-AU） | `/native/`（另有 iframe 页 `/native/frame.html`） | 英文：`Zhiyuan (Leo) Lin` |
| Ant Design（zh-CN） | `/antd/` | 中文：`林知远` |
| Element Plus（zh-CN） | `/element/` | 中文：`林知远` |

步骤：

1. 点工具栏的扩展图标打开侧边栏，在「当前简历」下拉框里选好对应的简历。
2. 回到测试页面，点右下角的悬浮按钮。按钮上会先显示识别到的字段数。
3. 对照页面上的边框颜色：
   - 绿色：已填写。
   - 黄色：待确认（有多个候选，或选项没有匹配项），字段保持为空。
   - 红色：未识别，或填写失败。
   - 没有边框：简历里没有这个字段的数据。
4. 按钮旁的摘要卡片列出各类数量和需要留意的字段。点某个字段可以在页面上定位。
5. 侧边栏是完整报告，按严重程度排序，可以按状态筛选。黄色的行可以采纳候选项，也可以点编辑图标输入文字再应用。

测试站里有几个故意设置的陷阱，M1 的预期是都不填：验证码、同意隐私条款的复选框、推荐人工号。

## 管理简历

在 `chrome://extensions` 的扩展详情里打开选项页，或从侧边栏进入。

- **简历库：** 新建（可选语言版本）、复制、删除，以及设为当前简历。
- **编辑器：** 按模块分页（基本信息、联系方式、求职意向、教育经历、工作和实习经历、项目、奖项、语言能力、推荐人、自我介绍）。重复模块可以增删条目。修改自动保存，格式不合法的值会就地提示。
- **附件：** 简历 PDF、证件照、成绩单，保存在 IndexedDB，遇到文件上传控件时使用。单个文件不超过 10 MB。
- **导入 / 导出：** 可以把全部简历和设置导出成 JSON。导入会**替换**现有的全部内容，导入前有确认。附件文件不在 JSON 里。
- **设置：** 界面语言（跟随浏览器、中文、English）。「填写前预览」目前只保存开关，功能本身还没做。

## 开发命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | WXT 开发模式 |
| `pnpm build` | 构建扩展到 `.output/chrome-mv3` |
| `pnpm zip` | 用 WXT 打包扩展 |
| `pnpm test` | 单元测试（Vitest + jsdom） |
| `pnpm test:watch` | 监听模式的单元测试 |
| `pnpm test:drivers` | 先构建页内 harness，再用 Playwright 在合成测试站上跑控件驱动和整页填写的准确率测试（不加载扩展） |
| `pnpm e2e` | 先构建，再把扩展装进 Chromium，在三个测试站上走完整流程（默认无界面） |
| `pnpm e2e:headed` | 同 `pnpm e2e`，但显示浏览器窗口 |
| `pnpm typecheck` | `wxt prepare`，再对扩展和测试站做类型检查 |
| `pnpm fixtures:dev` | 合成测试站的 Vite 开发服务器 |
| `pnpm fixtures:build` | 构建合成测试站 |
| `pnpm fixtures:preview` | 在 4173 端口预览合成测试站 |
| `pnpm harness:build` | 只构建页内测试 harness |

## 项目结构

| 路径 | 内容 |
|---|---|
| `entrypoints/` | 扩展入口：后台、内容脚本、悬浮按钮（`fab.content`）、选项页、侧边栏 |
| `src/background/` | 消息路由、frame 发现、按 frame 裁剪数据、写入示例简历 |
| `src/content/` | 各 frame 内容脚本的处理器和监听器 |
| `src/engine/` | 字段发现、分类、分组和填写计划 |
| `src/dictionary/` | 字段、选项和模块词典（中英文） |
| `src/drivers/` | 原生 HTML、Ant Design、Element Plus 的控件驱动 |
| `src/fill/` | 填写执行、高亮、报告、补建重复条目卡片 |
| `src/schema/` | 简历数据模型、字段键、迁移、示例简历 |
| `src/storage/`、`src/editor/` | 本地存储（简历和文件）、简历编辑逻辑、导入导出 |
| `src/messaging/`、`src/i18n/` | 消息协议与校验、界面文案 |
| `src/ui/` | 共用的设计令牌和主题 |
| `fixtures/synthetic/` | 合成测试站（原生、Ant Design、Element Plus） |
| `tests/` | 单元测试、驱动测试和端到端测试 |

## M1 已知限制

- 不支持日期范围选择器（起止日期合在一个控件里的那种）。单个日期和年月选择器可以。
- 组件库只支持原生 HTML、Ant Design 和 Element Plus，其他库以后再加。
- 没有 AI 层。字段识别靠词典和规则，认不出的字段留空并标红。
- 没有预览步骤，点一下就直接填。
- 新增条目卡片（第二段教育、第二段实习等）靠页面上「添加……」按钮的文字来识别。按钮文字不在词典里就点不到。
- 页面上没有添加按钮的模块，只填已有的卡片，简历里多出来的条目会跳过。
- 真实招聘网站的适配放在 M2。

## 隐私说明

- 简历、附件和设置只保存在本机的 `chrome.storage.local` 和 IndexedDB，不会上传到任何服务器。
- M1 没有任何网络请求。代码里没有 `fetch`、`XMLHttpRequest` 和 `WebSocket`，也没有第三方统计。
- 内容脚本运行在默认的 ISOLATED world，页面自己的脚本读不到扩展的变量。
- 简历数据从不经过 `window.postMessage`。内容脚本、后台和侧边栏之间只用扩展自己的消息通道（`chrome.runtime`）。
- 数据按需下发。后台先问每个 frame 识别到了哪些字段（这一步不带简历数据），再只把对应的值发给各个 frame。没有表单的 frame 什么都收不到，附件只发给有上传控件的 frame。
- 扩展不会通过 `window.postMessage` 向页面广播自己（已关闭 WXT 的 content-script-started 消息），页面拿不到扩展 ID。
- 权限只有 `storage`、`unlimitedStorage`、`sidePanel` 和 `webNavigation`（列出标签页里的各个 frame），不申请 `tabs`。
- 需要 `<all_urls>` 主机权限，因为扩展要在任意招聘网站上识别并填写表单。

## 设计令牌

三个界面（选项页、侧边栏、页面上的悬浮按钮）共用一套设计令牌，位于 `src/ui/tokens.ts` 和 `src/ui/theme.css`。目前的值是中性的默认值，之后会替换成作者自己的设计系统。

- 换样式只需改这两个文件，并保持 `tokens.ts` 和 `theme.css` 同步。`tests/unit/ui/tokens.test.ts` 会检查两边的名字和值一致，也会检查三个界面里没有写死的颜色和未定义的令牌。
- 命名：颜色用 `--raf-color-*`，其余有 `--raf-font-*`、`--raf-radius-*`、`--raf-space-*`、`--raf-shadow-*`、`--raf-motion-*`、`--raf-z-*` 和 `--raf-size-*`。
- 悬浮按钮在 shadow root 里引入 `theme.css`，页面的 CSS 改不到。
- 页面元素上的高亮描边是行内样式，用不了 CSS 变量。三种颜色是 `tokens.ts` 里的常量 `HIGHLIGHT_COLORS`。
- `public/icon/` 里的扩展图标目前是占位图，会随设计系统一起替换。
