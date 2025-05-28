# GitHub Workflows

这个目录包含了 Algonius Browser 项目的 GitHub Actions 工作流配置。

## 工作流概述

### `pr-check.yml` - PR 构建和测试
**触发条件**: 向 `main` 或 `develop` 分支提交 PR

**功能**:
- **类型检查**: TypeScript 类型检查
- **代码检查**: ESLint 代码质量检查  
- **构建**: 构建扩展项目

## 使用指南

### 对于贡献者

1. **创建 Pull Request 时**:
   - 工作流会自动触发构建和测试
   - 必须通过所有检查才能合并

2. **代码质量要求**:
   - TypeScript 代码不能有类型错误
   - 所有代码必须通过 ESLint 检查
   - 项目必须能够成功构建

### 对于维护者

1. **监控构建状态**:
   - 在 GitHub Actions 标签页查看工作流状态
   - 只有通过所有检查的 PR 才应该被合并

## 环境要求

- **Node.js**: v22.12.0
- **pnpm**: v9.15.1

## 故障排除

### 常见问题

1. **构建失败**:
   - 检查 Node.js/Go 版本要求
   - 确认所有依赖项已正确安装
   - 查看工作流输出中的错误日志

2. **代码质量检查失败**:
   - 运行 `pnpm prettier` 修复格式问题
   - 运行 `pnpm lint` 修复代码质量问题
   - 运行 `pnpm type-check` 检查 TypeScript 错误

3. **需要帮助**:
   - 查看工作流日志了解详细错误信息
   - 查阅项目的主 README 获取设置说明
