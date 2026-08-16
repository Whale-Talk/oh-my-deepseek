# oh-my-deepseek

> 给 **DeepSeek Harness** 用的多智能体编排插件集，灵感来自 [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode)。

一个 npm 包 = 一个 **bundle**，里面放多个插件。当前内置两个插件：

| 插件 | 工具名 | 作用 | 对应 OMC |
|---|---|---|---|
| `ralplan` | `ralplan` | Planner → Architect → Critic 共识规划循环，直到通过或到轮次上限 | `ralplan` |
| `team` | `team` | 拆解 → 并行执行 → 验证 → 修复循环 | `team` |

---

## 原理（一句话）

DSH 是"万物皆插件"：一个插件 = 导出 `name` / `inject` / `apply(ctx, config)` 的模块，`apply` 里往 `ctx.tools` 注册工具、往 `ctx.systemPrompt` 挂引导。这里的两个插件**不依赖 Claude Code**，而是复用 DSH 原生的两个能力接缝：

- `ctx.workflowEngine` —— 真正执行编排脚本（`agent()` / `parallel()` / `pipeline()` 等钩子）；
- `ctx.subagents` —— 按名注册的子 agent provider（默认 `spawn`，进程内全新子 agent）。

所以每个插件就是一个"**固定 Cordis 工具**"：模型只提供 `objective` 数据，循环/排序/schema 由插件写死、模型无法改写。这与 OMC"给 LLM 一篇 markdown 剧本让它去演"是本质区别——这里编排是**编译进去的代码**。

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

启动后，agent 面前会多出 `ralplan` 和 `team` 两个工具，以及各自的使用说明（system prompt section）。

> 不需要额外 provider：`dsh-base` 已提供 `workflowEngine`、`subagents`、`tools`、`systemPrompt`，默认 provider `spawn` 支持结构化输出。

---

## 用法

```
"ralplan：帮我评审并规划 XXX 的实现方案"
"team：把 src/ 里的 TypeScript 报错全修掉"
```

两个工具都返回一个结构化结果（plan / 状态），父 agent 只看到最终结果，中间每个子 agent 的上下文不进入父对话。

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

## 目录结构

```
oh-my-deepseek/
├── package.json            # dsh.bundle.patch 声明 + exports 子路径
├── cordis.patch.yml        # bundle 层：insert ralplan + team 两行
├── tsdown.config.ts        # prepare 构建（外部化 @deepseek-ai/*）
├── tsconfig.json           # dev typecheck（需能解析 DSH 类型）
├── vitest.config.ts        # 测试 + 覆盖率门槛（核心 ≥90%）
├── .npmrc                  # legacy-peer-deps（跳过未发布的 DSH peer）
├── .github/workflows/ci.yml # build + test + coverage
├── THIRD_PARTY_NOTICES.md  # 角色提示词的 MIT 版权声明
├── scripts/copy-roles.mjs  # 构建后拷贝角色到 lib/roles/
├── src/
│   ├── index.ts            # 程序化使用时的 re-export
│   ├── shared.ts           # provider 校验 / 结果渲染等公共辅助
│   ├── scripts.ts          # 固定编排脚本 + meta（可单测的核心逻辑）
│   ├── roles.ts            # 角色加载器（fileURLToPath 定位）
│   ├── roles/              # 5 个角色，OMC 原版字节级一致
│   ├── ralplan.ts          # 插件：ralplan
│   └── team.ts             # 插件：team
└── test/
    ├── shared.test.ts      # 纯函数（正常/边界/异常）
    ├── roles.test.ts       # 角色完整性与 marker 校验
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

**测试策略**：编排的核心逻辑抽在 `src/scripts.ts`（固定脚本字符串）和 `src/shared.ts`（纯函数）里，这两块**不依赖** `@deepseek-ai/*`，可以在裸环境直接单测。`src/ralplan.ts` / `src/team.ts` 是 DSH 胶水（import 尚未发布到 npm 的 `@deepseek-ai/*`），由 loader 在真实 profile 里验证，不纳入单测。CI（`.github/workflows/ci.yml`）跑 `build + test + coverage` 三步。

类型检查需要在能解析 `@deepseek-ai/*` 的环境里跑（这些包尚未发布到 npm，运行时由 DSH 安装树通过 parent-walk 提供）。两种做法：

1. 在 profile 目录内 `dsh plugin --profile demo add ./oh-my-deepseek` 后，profile 的 node_modules 已含 DSH 包，把本项目的 tsconfig `paths`/`types` 指过去再 `tsc --noEmit`；
2. 本地把 DSH 仓库的 `packages/*/*` 链接进来后 `tsc --noEmit`。

`npm run prepare` 会在 git 安装时自动构建，因此**不要**把 `lib/` 提交进 git（已在 `.gitignore`）。

---

## 与 OMC 的差异（设计说明）

- **ralph / ultragoal**：DSH 已内置 `ralph` 与 `goal` 工具，**不需要**在本项目复刻。
- **ralplan / team**：OMC 是"角色库 + 流程剧本"；本项目把**流程**编译成 DSH 的固定 workflow 插件（循环/排序/schema 由代码决定），而**角色提示词完整移植**为 `src/roles/*.md`（见上节）。两样东西都保留了 OMC 的实质，差异只在"流程由代码执行而非由 LLM 演绎"。
- **git worktree 并行 + merge 冲突协调**：OMC `team` 独有、DSH 无对应件，暂未实现（子 agent 直接在共享 workspace 里协作，冲突由模型/executor 自行处理）。是后续最值得补的一块。
- **模型分级路由**：OMC 按角色分 `opus/sonnet/haiku`，DSH 目前统一走 `subagentProvider` 的单一模型；按角色分模型是待办。
- **工具硬禁用**：OMC 的 `disallowedTools: Write, Edit`（critic/architect/verifier 只读）在 DSH 侧目前是 prompt 软约束；做真·只读需要 DSH 的 `toolFilter`，也是待办。
