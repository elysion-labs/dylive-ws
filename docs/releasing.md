# CI 与发布

推送分支或更新 PR 时，CI 用 Node.js 24 和 Bun 1.4.4 从冻结的锁文件安装依赖，并运行 `vp run ready`。该命令依次执行格式和 lint 检查、类型检查、离线测试与包构建。离线测试包含真实快照回放，无需 Cookie。

有需要发布的改动时，运行 `vp run changeset` 并提交生成的变更说明。Changesets 在 `main` 更新后创建或更新发版 PR。PR 更新包版本和变更日志，并在生成时同步锁文件。标题包含包名与版本。首个 changeset 将 `0.0.0` 提升到 `0.1.0`。

合并发版 PR 后，Release 工作流再次运行 `vp run ready`，然后用 npm 11 发布到 npm，创建对应的 Git 标签和 GitHub Release。

## 启用自动发布

1. 在 GitHub 仓库的 **Settings → Actions → General** 中启用 **Allow GitHub Actions to create and approve pull requests**。如果发版 PR 显示 **Approve workflows to run**，有仓库写权限的维护者可以批准这一轮 CI。
2. 在 npm 的 `@elysionjs/dylive-ws` 包设置中添加 GitHub Actions Trusted Publisher。组织填 `elysion-labs`，仓库填 `dylive-ws`，工作流文件填 `release.yml`，环境留空，并允许 `npm publish`。发布通过 OIDC 认证并生成 provenance。配置步骤见 [npm 官方文档](https://docs.npmjs.com/trusted-publishers/)。
