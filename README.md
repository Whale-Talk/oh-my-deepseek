# oh-my-deepseek

> 给 **DeepSeek Harness** 用的多智能体编排 + 网络搜索插件集，灵感来自 [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode)。

一个 npm 包 = 一个 **bundle**，内含多个插件。当前内置：

| 插件 | 工具/技能 | 作用 | 对应 OMC |
|---|---|---|---|
| `ralplan` | 工具 `ralplan` | Planner → Architect → Critic 共识规划循环，直到通过或到轮次上限 | `ralplan` |
| `team` | 工具 `team` | 拆解 → 并行执行 → 验证 → 修复循环 | `team` |
| `deep-interview` | 工具 `deep_interview_score` + 技能 `deep-interview` | 苏格拉底式需求访谈 + 数学模糊度门控（逐轮提问、加权评分、本体稳定性） | `deep-interview` |
| `exa-search` | 搜索 provider（`web_search` 后端） | 免密钥 Exa MCP 网络搜索，替换 DeepSeek 官方搜索路由（无需 API key） | （无；借鉴 Nexus-Code / opencode 的 keyless Exa MCP 方案） |

---

## 原理

DSH 是"万物皆插件"：一个插件 = 导出 `name` / `inject` / `apply(ctx, config)` 的模块，`apply` 里往 `ctx.tools` 注册工具、往 `ctx.systemPrompt` 挂引导。这里的编排插件**不依赖 Claude Code**，而是复用 DSH 原生的能力接缝：

- `ctx.workflowEngine` —— 真正执行编排脚本（`agent()` / `parallel()` / `pipeline()` 等钩子）；
- `ctx.subagents` —— 按名注册的子 agent provider（默认 `spawn`，进程内全新子 agent）。

所以这些编排插件都是"**固定 Cordis 工具**"：模型只提供 `objective` 数据，循环/排序/schema 由插件写死、模型无法改写。这与 OMC"给 LLM 一篇 markdown 剧本让它去演"是本质区别——这里编排是**编译进去的代码**。

---

## 安装

前置：本地已装好 `dsh` CLI（`pnpm dsh` 或发布版均可）。

```sh
# 从本目录（源码 checkout）安装进 profile
dsh plugin --profile demo add ./oh-my-deepseek

# 或从 GitHub 安装（git 安装会跑 prepare 构建；pnpm≥10 需要按提示 allowBuild）
dsh plugin --profile demo add github:you/oh-my-deepseek
```

然后启动：

```sh
dsh --profile demo
```

启动后，agent 面前会多出 `ralplan`、`team`、`deep_interview_score` 三个工具和 `deep-interview` 技能，并把模型可见的 `web_search` 工具后端从 DeepSeek 官方搜索路由切到免密钥 Exa MCP（见下文 `exa-search`）。

> 不需要额外 provider：`dsh-base` 已提供 `workflowEngine`、`subagents`、`tools`、`systemPrompt`、`web`，默认 provider `spawn` 支持结构化输出。
>
> **已运行的实例不会热加载新插件**：DSH 的 host 侧 cordis 插件树只在 boot 时组合，`dsh plugin add` 之后**必须重启**该 profile 的进程（`dsh web` 同理，关掉再起）才会生效。client-plugin HMR 只管 web 前端产物，不管 host 侧插件。

### ⚠️ 本地开发：peer 依赖 symlink

`@deepseek-ai/*`（cordis / schemastery / dsh-tools / …）**尚未发布到 npm**，所以 `npm install` 无法装进本项目；运行时由 DSH 安装树在 `$DSH_HOME/profiles/node_modules/@deepseek-ai` 提供。而 `dsh plugin add ./oh-my-deepseek` 用的是 `link:`（symlink 指向本 checkout），Node 默认 realpath 后，模块内部的 `import "@deepseek-ai/..."` 会从**本 checkout** 向上找 node_modules —— 找不到 profile 里那份。

因此本地开发需要先跑一次：

```sh
npm run link:peers
```

它把运行时所需的 `@deepseek-ai/*` 以 symlink 镜像进本项目的 `node_modules/@deepseek-ai`（已 gitignore）。这一步只影响本地开发；等 `@deepseek-ai/*` 发布到 npm 后，`peerDependencies` 会被正常安装，可删掉此步骤。

---

## 用法

```
"ralplan：帮我评审并规划 XXX 的实现方案"
"team：把 src/ 里的 TypeScript 报错全修掉"
"帮我搜一下 PX4 飞控的最新稳定版"（web_search，走免密钥 Exa 后端）
```

编排工具都返回一个结构化结果（plan / 状态），父 agent 只看到最终结果，中间每个子 agent 的上下文不进入父对话。`exa-search` 不是模型工具，而是 `web_search` 工具的后端 provider：模型照常调用 `web_search`，底层由它代答，模型无感。

### 配置项（可在一个更晚的 patch 层按 `id` 覆盖，覆盖会替换整份 `config`）

`ralplan`（id `omd-ralplan`）：

| key | 默认 | 含义 |
|---|---|---|
| `toolName` | `ralplan` | 模型可见的工具名 |
| `maxIterations` | `5` | 评审轮次上限（部署上限） |
| `subagentProvider` | `spawn` | 每轮子 agent 的 provider |
| `maxResultChars` | `50000` | 父侧渲染结果上限 |

`team`（id `omd-team`）：

| key | 默认 | 含义 |
|---|---|---|
| `toolName` | `team` | 模型可见的工具名 |
| `maxIterations` | `3` | verify/fix 轮次上限 |
| `maxSubtasks` | `12` | 一次运行最多拆出的子任务数 |
| `subagentProvider` | `spawn` | 子 agent provider |
| `maxResultChars` | `50000` | 父侧渲染结果上限 |

`exa-search`（id `omd-exa-search`）：

| key | 默认 | 含义 |
|---|---|---|
| `baseURL` | `https://mcp.exa.ai/mcp` | 免密钥 Exa MCP 端点 |
| `toolName` | `web_search_exa` | Exa MCP 端点的工具名 |
| `numResults` | `6` | 请求未带 `maxResults` 时的默认结果数 |

切回 DeepSeek 官方搜索（若你有有效 key），在更晚的 patch 层把 `web` 那行改回 `searchProvider: deepseek-official` 即可。

---

## 角色提示词（完整移植）

`ralplan` / `team` 的每个 worker 都使用 OMC 的**完整原版角色提示词**，而不是精简改写版。这 5 个角色以 Markdown 原样存放在 `src/roles/`，构建时拷贝到 `lib/roles/`，插件运行时按模块相对路径加载（不依赖 `cwd`）：

| 角色 | 用于 | 上游源文件 |
|---|---|---|
| `planner` | ralplan 规划 + team 拆解 | `agents/planner.md`（140 行） |
| `architect` | ralplan 钢人式反驳 | `agents/architect.md`（129 行） |
| `critic` | ralplan 最终质量门 | `agents/critic.md`（280 行） |
| `executor` | team 并行执行 | `agents/executor.md`（121 行） |
| `verifier` | team 验收验证 | `agents/verifier.md`（114 行） |

移植原则（诚实说明，不作事后粉饰）：

- **正文 100% 原样**：`src/roles/*.md` 与上游 `agents/*.md` **字节级一致**（含 frontmatter、调查协议、失败模式、输出合同等全部内容），可 `diff` 对比。
- **平台适配不篡改原文**：DSH 侧需要的"结构化输出契约、verdict 映射、忽略 Claude 工具引用"等，作为一段 `<DSH 适配指令>` **追加**在角色正文之后（见 `src/scripts.ts`），不改写正文。
- **已知差异**（正文保留、但 DSH 不消费的字段）：`model: opus/sonnet`（Anthropic 模型分级，DSH 由 `subagentProvider` 统一决定）、`disallowedTools: Write, Edit`（Claude 工具名，在 DSH 里作为只读软约束存在，未做硬工具禁用）、`.omc/` 状态路径与 `/oh-my-claudecode` 命令（DSH 无对应物，适配指令已让 worker 忽略）。

## deep-interview（忠实改编 + 数学门控）

`deep-interview` 与 ralplan/team 类型不同：它不是"开多个子 agent 编排"，而是**和用户逐轮对话的苏格拉底访谈**。因此它拆成两部分移植：

1. **确定性数学门控 → `deep_interview_score` 工具**（`src/scoring.ts` + `src/deep-interview.ts`）。加权平均模糊度公式（greenfield 40/30/30，brownfield 35/25/25/15）和本体稳定性计算（stable/changed/new/removed，改名实体 >50% 字段重叠计入稳定）是**精确代码**，模型只喂分维度判断、不手算加权平均。已 100% 单测覆盖。
2. **访谈剧本 → `deep-interview` 技能**（`src/skills/deep-interview.md` + `src/deep-interview-skill.ts`）。通过 `ctx.skills.registerProvider()` 注册为 DSH 内置技能（仿 `skill-badge`），模型经 `skill` 工具加载后遵循剧本：一次一问、Round 0 拓扑门、最弱维度定向、挑战模式（4/6/8 轮）、spec 结晶、审批门控的 execution bridge（→ 本项目的 `ralplan`/`team`，或 DSH 内置 `ralph`）。

**诚实说明**：技能的剧本是**忠实改编**而非字节级一致（角色提示词才是字节级一致）——因为剧本里有大量 OMC 平台专有管道（`.omc/` 状态、`state_write`、`omc-plan`/`autopilot` 交接、companyContext、autoresearch），在 DSH 里无对应物，必须映射到 DSH 等价物（`ask_user_question`、subagent、`ralplan`/`team`/`ralph` 工具）。方法论实质（模糊度门控、拓扑门、挑战模式、spec 结构、三轮质量门）全部保留。

## 目录结构

```
oh-my-deepseek/
├── package.json            # dsh.bundle.patch 声明 + exports 子路径
├── cordis.patch.yml        # bundle 层：insert ralplan + team + deep-interview + exa-search 行，并把 web.searchProvider 指向 exa
├── tsdown.config.ts        # prepare 构建（外部化 @deepseek-ai/*）
├── tsconfig.json           # dev typecheck（需能解析 DSH 类型）
├── vitest.config.ts        # 测试 + 覆盖率门槛（核心 ≥90%）
├── .npmrc                  # legacy-peer-deps（跳过未发布的 DSH peer）
├── .github/workflows/ci.yml # build + test + coverage
├── THIRD_PARTY_NOTICES.md  # 角色提示词的 MIT 版权声明
├── scripts/copy-roles.mjs  # 构建后拷贝 roles/ + skills/ 到 lib/
├── src/
│   ├── index.ts            # 程序化使用时的 re-export
│   ├── shared.ts           # provider 校验 / 结果渲染 / git 差分等公共辅助
│   ├── scripts.ts          # 固定编排脚本 + meta（可单测的核心逻辑）
│   ├── scoring.ts          # deep-interview 确定性数学（模糊度 + 本体稳定性）
│   ├── roles.ts            # 角色加载器（fileURLToPath 定位）
│   ├── roles/              # 5 个角色，OMC 原版字节级一致
│   ├── skills/deep-interview.md  # 访谈剧本（忠实改编）
│   ├── ralplan.ts          # 插件：ralplan
│   ├── team.ts             # 插件：team
│   ├── deep-interview.ts   # 插件：deep_interview_score 工具
│   ├── deep-interview-skill.ts   # 插件：deep-interview 内置技能
│   └── exa-search.ts       # 插件：免密钥 Exa MCP 搜索 provider（web_search 后端）
└── test/
    ├── shared.test.ts      # 纯函数（正常/边界/异常）
    ├── roles.test.ts       # 角色完整性与 marker 校验
    ├── scoring.test.ts     # 模糊度门控数学（权重/稳定性/边界）
    └── scripts.test.ts     # 编排脚本语法 + 循环行为 + 角色注入
```

---

## 开发

```sh
npm install             # 装 tsdown + typescript + vitest
npm run build           # 转译 src/ -> lib/（不含类型检查）
npm test                # 单元测试（核心逻辑：正常/边界/异常）
npm run test:coverage   # 测试 + 覆盖率门槛（核心模块 ≥90%）
```

**测试策略**：可单测的核心抽在 `src/shared.ts`（纯函数）、`src/scripts.ts`（固定脚本字符串）和 `src/scoring.ts`（确定性数学）里，这三块**不依赖** `@deepseek-ai/*`，可以在裸环境直接单测。`src/ralplan.ts` / `src/team.ts` / `src/deep-interview.ts` / `src/deep-interview-skill.ts` / `src/exa-search.ts` 是 DSH 胶水（import 尚未发布到 npm 的 `@deepseek-ai/*`），由 loader 在真实 profile 里验证，不纳入单测。CI（`.github/workflows/ci.yml`）跑 `build + test + coverage` 三步。

类型检查需要在能解析 `@deepseek-ai/*` 的环境里跑（这些包尚未发布到 npm，运行时由 DSH 安装树通过 parent-walk 提供）。两种做法：

1. 在 profile 目录内 `dsh plugin --profile demo add ./oh-my-deepseek` 后，profile 的 node_modules 已含 DSH 包，把本项目的 tsconfig `paths`/`types` 指过去再 `tsc --noEmit`；
2. 本地把 DSH 仓库的 `packages/*/*` 链接进来后 `tsc --noEmit`。

`npm run prepare` 会在 git 安装时自动构建，因此**不要**把 `lib/` 提交进 git（已在 `.gitignore`）。

---

## 本地实机验证

装进 profile 后，按下面顺序确认它真的加载成功（每一步都是实测跑通过的方法）：

### 1. 确认配置组合正确

```sh
dsh --profile web --dump-config
```

输出末尾应出现 `# == oh-my-deepseek` 一层，含 `omd-ralplan` / `omd-team` / `omd-deep-interview-*` / `omd-exa-search` 各行及完整默认 config，且 `web` 行的 `searchProvider` 为 `exa`。没有这层说明 `dsh.bundle.patch` 声明没被识别（reconcile 失败）。

### 2. 确认模块能被 import

从 profile 目录、用默认 Node 解析（等价 loader 的 realpath 行为）：

```sh
cd "$DSH_HOME/profiles/web"
node --input-type=module -e "import('oh-my-deepseek/ralplan').then(m=>console.log(Object.keys(m)))"
```

应打印 `[ 'Config', 'apply', 'inject', 'name' ]`（Cordis 插件四要素）。若报 `ERR_MODULE_NOT_FOUND Cannot find package '@deepseek-ai/...'`，说明没跑 `npm run link:peers`（见上文）。

### 3. 端到端 smoke test（不依赖 GUI）

用 headless profile 起一个最小会话，验证插件 import + apply + 工具注册 + LLM 全链路：

```sh
# 先把插件也装进 headless（headless 是 headless-runner，适合一键验证）
dsh plugin --profile headless add ./oh-my-deepseek
# 让模型只回一句固定话：插件若加载失败，boot 会 fail loud 而不是正常回复
dsh --profile headless "Reply with exactly: PLUGINS_LOADED_OK"
```

正常返回 `PLUGINS_LOADED_OK`（exit 0）即代表加载链路全通。

### 4. 实测性能提示（重要）

完整移植的 OMC 角色提示词（尤其 critic 280 行）+ `reasoningEffort: high`，会让 **ralplan 每轮评审相当慢**——实测一次完整的 Planner→Architect→Critic 编排可能跑十几分钟还没结束（是"慢"，不是卡死：进程持续有到 LLM 端点的连接、持续消耗 CPU）。这属于预期成本：

- 若只想快速验证链路，用上面第 3 步的 smoke test，别真跑完整 ralplan；
- 生产/日常想提速，可把 `llm-deepseek` 的 `reasoningEffort` 降到 `medium` 或 `low`（在 `$DSH_HOME/settings.yaml` 里），或减少 `maxIterations`。

### 5. 开发循环

profile 通过 `link:` 指向本 checkout，运行时读的是 **`lib/`（构建产物），不是 `src/`**。改完 TS 后要：

```sh
npm run build     # 重新转译 + 拷贝角色文件到 lib/roles/
# 然后重启目标 profile 的进程（见"安装"里的重启提示）
```

`src/roles/*.md` 是运行时按 `import.meta.url` 相对 `lib/roles/` 读取的，所以**改了角色文件也要 rebuild**（`copy-roles.mjs` 会把它拷进 `lib/roles/`）。

---

## 与 OMC 的差异（设计说明）

- **ralph / ultragoal**：DSH 已内置 `ralph` 与 `goal` 工具，**不需要**在本项目复刻。
- **ralplan / team**：OMC 是"角色库 + 流程剧本"；本项目把**流程**编译成 DSH 的固定 workflow 插件（循环/排序/schema 由代码决定），而**角色提示词完整移植**为 `src/roles/*.md`（见上节）。两样东西都保留了 OMC 的实质，差异只在"流程由代码执行而非由 LLM 演绎"。
- **git worktree 并行 + merge 冲突协调**：OMC `team` 独有、DSH 无对应件，暂未实现（子 agent 直接在共享 workspace 里协作，冲突由模型/executor 自行处理）。是后续最值得补的一块。
- **模型**：所有 worker 统一使用 `subagentProvider` 的默认模型，不做按角色分模型（OMC 的 opus/sonnet/haiku 分级不映射）。角色文件里的 `model:` frontmatter 仅作为上游原文保留，不被消费。
- **工具硬禁用（只读角色）**：采用**软约束 + 事后检测**（路线 C）。OMC 的 `disallowedTools: Write, Edit` 在 DSH 侧当前做不到工具级硬禁用（workflow 的 `agent()` 钩子不支持 `toolFilter`，而 `toolFilter` 是 DSH 里唯一的硬移除手段）。落地为三层：(1) critic/architect/verifier 的适配指令强声明 READ-ONLY、禁用 `write`/`edit`/`str_replace_editor`；(2) verifier 结构化报告里必填 `modifiedFiles` 自证；(3) 插件层在 team run 前后各跑一次 `git status --porcelain`，把运行期新增/变化的文件（`changedFiles`）附到结果，供父 agent 复核。已知局限：git 快照只能捕捉状态变化、捕捉不到"已改动文件又被二次改动"，且 git 不可用时静默跳过——归因仍主要靠 verifier 自证 + 软约束，不是事前硬保证。
