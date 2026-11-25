# Changesets

包的行为或公开 API 有改动时，运行 `vp run changeset`，选择 `@elysionjs/dylive-ws` 的版本级别并填写面向使用者的变更说明。将生成的 Markdown 文件与代码一同提交。

合并到 `main` 后，Release 工作流创建或更新发版 PR。合并发版 PR 后，工作流重新检查、测试并构建，再发布 npm 包和 GitHub Release。仓库权限与 npm Trusted Publisher 配置见 [发布文档](../docs/releasing.md)。
