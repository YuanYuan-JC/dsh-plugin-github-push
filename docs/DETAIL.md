# 推送到 GitHub（Push to GitHub）

在 DeepSeek Harness 的会话里，把正在开发的项目**在用户明确发出推送指令时**提交并推送到 GitHub，按需创建 GitHub 仓库与 Pull Request，并让官方“变更请求与工作树”面板跟踪该 PR 的检查、评审与差异。

**平时编辑文件不会提交。** 本插件不注册定时器、钩子或回合监听器；提交只可能发生在一次显式推送调用内部。

## 安装

本插件以本地 bundle 形式开发：在 DSH 的 **设置 → 插件** 页把本目录（绝对路径）安装到当前 profile，或在插件页的安装框中填包名。安装后请在新会话中验证。

## 三种使用方式

| 入口 | 谁用 | 说明 |
|---|---|---|
| 工具 `github_push` | 模型 | 当你说“把这个项目推送到 GitHub”时，模型调用它。参数 `action` 支持 `plan`（预览）、`apply`（默认，提交并推送）、`status`（读取已绑定的 PR 与当前提交检查）。可传 `message` 提交信息、`repo` 目标仓库、`visibility`、`branch`、`createPr`、`draft`、`branchPolicy`、`tag`、`tagMessage`、`release`、`force`。 |
| 斜杠命令 `/github-push` | 人 | 不经过模型、不消耗模型 token，直接完成提交与推送；命令后的文字作为提交信息。 |
| 输入区「推送」按钮 | 人 | 位于输入框工具行左侧。点击后弹出预览：分支/目标分支/仓库/改动/提交信息/是否建 PR/新仓库可见性；确认后提交并推送，结果保留在弹窗中（不再常驻输入区卡片）。 |
| 会话视图「Git」tab | 人 | 在“轨迹/统计”旁的视图 tab：展示提交泳道图、分支 ref、绑定的 PR 与 checks 徽章；头部显示仓库/分支/ahead-behind/checks，可手动刷新。打开 tab、点击刷新、或本会话推送完成后更新，**不自动轮询**。 |
| 先预览再执行 | 两者 | 工具传 `action: "plan"`（或 `dryRun: true`）只做计划，不写文件、不提交、不推送。 |

按钮只调用宿主侧同一个服务（通过同源 `/api/github-push/*` 路由），因此按钮、斜杠命令与模型工具的行为、安全策略完全一致。

## 一次 `apply` 做了什么

1. 检查会话工作目录、沙箱模式、git 与 `gh`。
2. 必要时 `git init`（默认分支 `main`）。
3. 缺少 git 作者身份时，从已登录的 GitHub 账号推导 **仓库本地**身份（不改全局 git 配置）。
4. 有改动时暂存并**恰好提交一次**（提交信息来自工具参数或命令输入，缺省用确定性模板）。
5. 没有 `origin` 远端时，用 `gh` 创建 GitHub 仓库（默认 private，显式传 public 才公开）并添加远端。
6. 推送当前分支并设置 upstream。
7. 默认在默认分支上先创建 `dsh/<中文名>/<EnglishName>` 分支；分支不是默认分支时复用或创建 PR，随后调用 `ctx.forgeSession.track` 把 PR 绑定到本会话，右侧栏“变更请求”面板即可跟踪检查、评审与 diff。
8. 读取推送提交的 combined checks（GitHub Actions check-runs + commit statuses）并返回；目标分支与 PR 绑定后，“Git”视图可刷新查看更新。
9. 返回仓库、提交、PR 链接、检查状态与警告。

### 功能分支策略（`branchPolicy: "feature"`）

**默认开启**。在默认分支上推送时，会先创建并切换该分支；对话框里可取消勾选“新建 dsh/ 功能分支并创建 PR”（或工具传 `branchPolicy: "current"`）改为直接推默认分支：

- 分支默认命名为 **`dsh/<package-name>`**（公开发布友好的 ASCII 名称，例如 `dsh/github-push`）；若项目没有 `package.json`，退回项目目录名的 ASCII slug，再退回 `project`。个人项目可把配置 `branchNaming` 改为 `"bilingual"`，恢复 `dsh/<中文名>/<EnglishName>`。
- 先创建并切换该分支，再提交、推送并以默认分支为 base 创建 PR；默认分支本身不被直接修改。同名分支已存在时自动追加 `-2`、`-3`。
- 新建仓库的首次推送仍会先初始化默认分支（此时还没有 base 可开 PR），之后再次推送即可使用该策略。

## Tag 与 Release

推送对话框与工具都支持可选的 tag / release：

- 填写 tag 名（如 `v1.2.0`）后：在本次提交上创建 annotated tag（注释默认取提交信息），推送 tag，并按默认创建 GitHub Release（标题 = tag 名，说明包含提交链接、分支）。
- 不想建 Release 时取消“同时创建 GitHub Release”，或工具传 `release: false`；`tagMessage` 可覆盖 tag 注释。
- 已存在同名 tag：指向 HEAD 时复用；指向其他提交时报 `tag-exists` 并提示先删除。Release 已存在时复用它，不重复创建。
- **Tag/Release 只允许在默认分支创建**：tag 请求会强制本次推送留在默认分支（不新建功能分支）；在功能分支上带 tag 会在提交前被 `release-requires-default-branch` 拒绝。推荐流程：PR 合并后、本地 main 已同步时再推 tag。
- tag 推送失败会以 `tag-create-failed` / `tag-push-failed` 报错（此时分支推送通常已完成，属于部分成功）；Release 创建失败只记录警告，不影响 tag 与分支推送结果。
- Git 视图的 ref 徽章会显示 tag（来自 `git log --decorate`）。

## Git 视图（会话 tab）

会话视图（“对话 / 轨迹 / 统计”）右侧新增 **Git** tab：

- 头部：仓库（可跳转 GitHub）、当前分支、ahead/behind、HEAD 提交 checks，以及刷新按钮。
- 主体：`git log --all` 的提交泳道图；每行显示 lane 线、ref 徽章（分支/远端）、提交 subject、作者/时间、短 SHA 链接。
- 绑定到本会话的 PR 会以徽章出现在对应提交上，并显示 PR 状态与 checks rollup；点击直达 GitHub。
- 数据由 Host 只读路由 `api/github-push/graph` 提供；刷新时机 = 打开 tab、点“刷新”、本会话推送完成；不做定时轮询。
- 非 Git 目录显示空状态。

## 安全与边界

- **只在指令时提交**：没有自动提交、没有提交每个回合、没有文件监听。
- **默认 private**：新建仓库只有显式 `visibility: "public"` 才公开。
- **不强制推送**：`force` 仅在显式开启时使用 `--force-with-lease`；从不使用 `--force`。
- **不自动合并、不自动改仓库设置**。
- **凭据**：使用宿主上已登录的 `gh`（keyring）；git 推送时按次注入 gh 的 credential helper，不写全局 git 配置。token 不进入模型上下文、命令行参数、`.git/config` 或日志。
- **敏感路径拦截**：提交前按 `denyPaths` 拒绝 `.env`、私钥等文件，可用 `allowSecretPaths` 放行，或关闭 `secretScan`。
- **沙箱**：只读会话拒绝执行；`workspace-write` 下要求仓库根位于会话可写工作区内；网络访问不会写入宿主文件系统之外。
- **无变更**：工作区干净时不会产生空提交，只推送已有提交；空仓库且无改动时报 `nothing-to-commit`。
- **冲突**：存在未解决冲突时拒绝提交；推送被拒绝（非快进）时不会自动合并或强推。
- **PR 失败不掩盖推送**：推送成功但建 PR 失败时，结果仍报告已推送，并在警告中指出原因。

## 配置

在 bundle 行的 `config` 中覆盖（安装后可在 profile 的 patch 层调整）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `hosts` | `["github.com"]` | 允许的 GitHub host（本版本只支持 github.com） |
| `ghCommand` / `gitCommand` | `"gh"` / `"git"` | 可执行文件，便于自定义 PATH 或测试 |
| `remoteName` | `"origin"` | 远端名 |
| `initRepo` | `true` | 无 `.git` 时是否自动初始化 |
| `createRemote` | `true` | 无远端时是否允许用 `gh` 创建仓库 |
| `visibility` | `"private"` | 新建仓库默认可见性 |
| `createPullRequest` | `true` | 非默认分支时自动建 PR |
| `branchPolicy` | `"feature"` | 默认 `feature`：默认分支上先建 `dsh/<package-name>` 分支再建 PR；`current` 则直接推当前分支（UI/工具也可按次覆盖） |
| `branchNaming` | `"public"` | `public` 用 ASCII 包名（公开发布推荐）；`bilingual` 用 locale 中英文标题 `dsh/中文/English` |
| `draftPullRequest` | `false` | 默认建 draft PR |
| `commitMode` | `"all"` | `all` 暂存全部改动；`staged` 只提交已暂存内容 |
| `configureIdentity` | `true` | 缺身份时用 gh 账号补仓库本地身份 |
| `secretScan` / `denyPaths` / `allowSecretPaths` | 开 / 见上 | 敏感路径拦截 |
| `allowedOwners` | `[]` | 允许推送的 owner；空表示仅当前登录账号 |
| `timeoutMs` / `pushTimeoutMs` | 120000 / 180000 | 命令超时 |
| `maxOutputBytes` | 1048576 | 单条命令输出上限 |

## 已知限制

- 本版本只支持 `github.com`；GitHub Enterprise / GitLab 未支持。
- 不做冲突解决或分支管理；tag/release 通过推送选项按次创建，不做版本号自动递增。
- 提交检查状态来自推送时的一次读取；“Git”视图不自动轮询，只在打开、点刷新或本会话推送完成后读取。
- 无 PR 时的提交检查仅显示 combined 状态与通过数；逐条检查内容仍以 GitHub Actions 页面为准。
- 依赖宿主安装并登录 `gh`；GitHub 凭据缺失或过期时给出可操作提示。
- 官方 forge 包为 experimental，本插件对 `ctx.forgeSession` 做可选检测；未启用 forge bundle 时推送仍可用，只是没有 PR 跟踪。
- 仓库 hooks 会随 `git commit` 执行（与用户自己的 git 工作流一致）。

## 兼容性

面向 DeepSeek Harness `0.2.2-rc.5`（Desktop profile）开发，使用 `ctx.tools.register`、`ctx.commands.register`、`ctx.shell`、`ctx.sandboxPolicy`、`ctx.sessions`、`ctx.workingDirectory` 与可选的 `ctx.forgeSession`。
