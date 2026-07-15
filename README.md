# Codex Miku Theme

本项目把本机 Codex Desktop 改造成角色中心、高饱和、冰蓝青绿与粉紫霓虹叠加的初音未来主题。

## 当前状态

- 已适配 Codex Desktop `26.707.72221`。
- 已安装到 `/Applications/ChatGPT.app/Contents/Resources/app.asar`。
- 当前安装版本为 `MAXIMAL v2`，并已把用户提供的初音参考图嵌入 Codex 内置图片资源槽。
- 原始 ASAR 已备份到 `/Users/blakexu/Library/Application Support/Codex Miku Theme/backups/b5da51e5df6e996076e4cb19045cec46dd4c08cf61c19cdbc5cb426b8413b73c.asar`。
- 安装后 ASAR 仍为 `195116466` 字节，其他资源偏移未改变。
- 自动测试为 `18 passed，0 failed`。
- 初音图片在 ASAR 中占用 `902530` 字节的固定资源槽，并已通过 macOS PNG 解码验证。

## 生效方法

当前 Codex 进程仍加载着旧资源。完成手头工作后，使用 `Command + Q` 完全退出 Codex，再从 Dock 重新打开。

## 检查状态

```bash
cd '/Users/blakexu/Documents/Codex 皮肤'
npm run check
```

## 官方更新后重新安装

```bash
open '/Users/blakexu/Documents/Codex 皮肤/scripts/install.command'
```

安装器会先校验新版 ASAR 结构。若入口容量或路径变化，它会拒绝写入，不会盲目修改。

## 一键恢复原版

```bash
open '/Users/blakexu/Documents/Codex 皮肤/scripts/restore.command'
```

## 签名边界

官方签名覆盖 `app.asar`。主题安装后，`codesign --verify` 会如实报告 `app.asar` 被修改。项目不会对应用进行临时重签名，因为那可能影响钥匙串和登录权限。若 macOS 阻止下次启动，先运行恢复脚本，即可回到官方完整签名资源。
