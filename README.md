# Codex Miku Theme

本项目把本机 Codex Desktop 改造成高饱和天蓝、粉紫、雾白玻璃、全高角色主视觉与动画宠物结合的初音未来主题。

## 当前状态

- 已适配 Codex Desktop `26.707.72221`，构建号 `5307`。
- v4 源码与安装包已完成；当前运行中的 Codex 仍是 v3，完全退出后运行安装器即可切换。
- 用户参考图已裁成全高主画布、角色、侧栏纹理和拍立得 4 张独立素材，并嵌入 4 个低频 PNG 资源槽。裁剪坐标、源图与目标图 SHA-256 记录在 `assets/miku-crops.json`。
- 原生 `Codex` 宠物槽已替换成与壁纸人物一致的 Q 版初音未来，保留待机、奔跑、跳跃、等待、审查、失败和转身动画。
- 真实根节点、侧栏选中态、主区域、顶栏、输入框、用户消息、助手消息、审批卡片和弹窗均已按稳定选择器覆盖。
- 原始 ASAR 已备份到 `/Users/blakexu/Library/Application Support/Codex Miku Theme/backups/b5da51e5df6e996076e4cb19045cec46dd4c08cf61c19cdbc5cb426b8413b73c.asar`。
- 安装后 ASAR 字节数保持不变，主题 CSS 为 `7997 / 8003` 字节。
- 自动测试包含真实 CLI 子进程的安装、宠物资源替换、失败回滚、同尺寸更新拒绝、v2 恢复、运行进程门禁、原子 CAS 前后竞态保护与完整往返测试。

## 生效方法

使用 `Command + Q` 完全退出 Codex，双击安装器，安装成功后再从 Dock 重新打开。打开「设置 > 宠物」并选择 `Codex`，显示的就是初音未来动画宠物。

## 最终实机截图

```bash
open '/Users/blakexu/Documents/Codex 皮肤/output/playwright/codex-miku-theme-v4-full-canvas-pet.png'
```

## 检查状态

```bash
cd '/Users/blakexu/Documents/Codex 皮肤'
npm run check
```

## 重新安装与版本边界

重新安装前必须先用 `Command + Q` 完全退出 Codex。安装器会检查整个应用包内是否还有活动进程，只要主进程、渲染器、更新辅助进程或工具进程仍在，就拒绝修改。

```bash
open '/Users/blakexu/Documents/Codex 皮肤/scripts/install.command'
```

安装器只接受已验证的 `26.707.72221（5307）`。它会校验当前完整 ASAR、CSS 容量、4 个背景图片槽和 1 个原生宠物槽，再用 macOS 原子交换完成 CAS 提交。若交换瞬间目标已变化，它会原子换回并拒绝覆盖；若状态文件写入失败，它会把 ASAR 回滚到本次安装前的精确字节。

Codex 官方升级后不要直接套用旧主题。安装器会拒绝未适配的新构建，避免用旧备份覆盖同尺寸更新；需要先按新构建重新确认入口与资源槽。

## 一键恢复原版

恢复前同样必须先完全退出 Codex。

```bash
open '/Users/blakexu/Documents/Codex 皮肤/scripts/restore.command'
```

恢复脚本会核对完整主题 ASAR 哈希。若 Codex 在安装后被更新或被其他工具修改，它会拒绝用旧备份覆盖。旧版 v2 状态会先验证主题 HTML、图片哈希和其余所有 ASAR 字节，再执行安全恢复。

## 重新生成裁图

```bash
open '/Users/blakexu/Documents/Codex 皮肤/scripts/build-assets.command'
```

脚本会先核对参考图 SHA-256，再用固定坐标和 FFmpeg 滤镜生成 4 张裁图，最后逐张核对目标 SHA-256。

## 签名边界

官方签名覆盖 `app.asar`。主题安装后，`codesign --verify --deep --strict` 的真实结果为 `a sealed resource is missing or invalid`。项目不会临时重签应用，因为这可能影响钥匙串和登录权限。若 macOS 阻止下次启动，先运行恢复脚本即可回到官方资源。
