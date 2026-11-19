# Push to GitHub（dsh-plugin-github-push）

在 DeepSeek Harness 会话里，把当前项目**在用户明确发出推送指令时**提交并推送到 GitHub，自动创建分支与 Pull Request，并把 PR/检查状态绑定回会话跟踪。

- 只在显式推送时提交：平时编辑文件不会产生 commit
- 默认 `branchPolicy=feature`：在默认分支上先建 `dsh/<package-name>` 分支再开 PR
- 支持 tag / GitHub Release：仅在合并后的默认分支创建
- 三种入口：模型工具 `github_push`、斜杠命令 `/github-push`、输入区「推送」按钮
- 会话视图 **Git** tab：提交泳道图、分支 ref、PR/checks 徽章
- 凭据复用宿主已登录的 `gh`；token 不进入模型上下文、命令行参数或 `.git/config`

仓库：https://github.com/YuanYuan-JC/dsh-plugin-github-push

## 安装

本插件是本地 bundle。克隆仓库后，在 DSH 的 **设置 → 插件** 中把本仓库根目录作为本地目录安装到当前 profile，或使用 `plugin_manager` 的 `install_bundle` 指向本目录：

```sh
git clone https://github.com/YuanYuan-JC/dsh-plugin-github-push.git
```

安装后在新会话中验证：

- 工具 `github_push`
- 斜杠命令 `/github-push`
- 输入区「推送」按钮
- 会话视图「Git」tab

## 使用

| 入口 | 说明 |
|---|---|
| 输入区「推送」按钮 | 预览分支/仓库/改动/提交信息/PR/tag，确认后提交并推送 |
| `/github-push [提交信息]` | 不经过模型，直接提交并推送 |
| 工具 `github_push` | `action: plan / apply / status`，可传 `message`、`repo`、`branchPolicy`、`tag`、`release` 等 |

首次推送新仓库会先 bootstrap 默认分支（此时还没有可供 PR 的 base），随后推送才走 `dsh/<package-name>` + PR。

## 配置

见 [`docs/DETAIL.md`](docs/DETAIL.md)。常用：

- `branchPolicy`：`feature`（默认）或 `current`
- `branchNaming`：`public`（默认，ASCII 包名）或 `bilingual`
- `visibility`：新建仓库默认 `private`
- `secretScan` / `denyPaths`：提交前敏感路径拦截

## 开发

```sh
npm test
```

CI 在 GitHub Actions 中运行同一命令。

## 要求

- DSH `0.2.2-rc.5`（Desktop profile）
- 宿主安装并登录 `gh`（GitHub CLI）
- 需要 GitHub 账号；新建仓库默认 private

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。

## 安全

漏洞报告与凭据处理说明见 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE)

## 状态

0.6.1：推送/跟踪、客户端 UI、分支策略、checks、Git 视图、tag/release 已实现；GitHub Enterprise/GitLab 与插件市场发布未做。
