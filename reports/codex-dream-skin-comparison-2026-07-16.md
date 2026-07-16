# Codex Dream Skin 与 Codex Miku Theme 对比核查

核查日期：2026 年 7 月 16 日

对比对象：

1. `Fei-Away/Codex-Dream-Skin`，公开分支 `main`，最新提交 `568469a4`。
2. `HeiGeAi/codex-miku-theme`，公开分支 `main`，最新提交 `fdf374e2`，公开 Release 为 `v4.0.0`。
3. 本机 `codex-miku-theme` 后续开发状态，包含两个尚未推送提交及已暂存的 v5 改动。

## 一、结论

这不是两个同类实现的简单换皮，而是两条相反的技术路线。

`Codex Dream Skin` 是通用型、跨平台、运行时注入的主题工作室。它用本机回环 CDP 启动并持续连接 Codex，在渲染器中注入 CSS 和装饰 DOM，不改官方应用包。

`Codex Miku Theme` 是单主题、高还原度、构建级补丁方案。它针对一个已验证的 macOS Codex 构建，离线修改 `app.asar` 内固定尺寸资源和 CSS 槽，再把初音未来宠物接入 Codex。

前者的强项是通用性、Windows 支持、可换图、官方签名不受影响。后者的强项是整机一致性、原生宠物、无需运行时注入守护进程，以及更严格的 ASAR 备份、指纹和原子回滚验证。

## 二、核心差异矩阵

| 维度 | Codex Dream Skin | Codex Miku Theme 公开版 | Miku 本机 v5 开发版 |
| --- | --- | --- | --- |
| 定位 | 通用主题工作室 | 初音未来专属完整主题 | 更完整的初音未来产品包 |
| 平台 | macOS 与 Windows | macOS | macOS |
| 生效方式 | CDP 运行时注入 CSS 和 DOM | 修改 `app.asar` 固定尺寸资源 | 同左，并把宠物改为独立原生自定义宠物 |
| 是否改官方包 | 不改 | 会改 | 会改 |
| 代码签名 | 保持官方签名 | 修改后签名校验失败 | 修改后签名校验失败 |
| Codex 升级适应性 | 相对更强，选择器变化时仍需维护 | 严格锁定 `26.707.72221（5307）` | 继续严格锁构建和完整资源指纹 |
| 常驻组件 | 需要 CDP 端口及注入器维持 | 安装后不需要 CDP 注入器 | 安装后不需要 CDP 注入器，一次性 LaunchAgent 会自清理 |
| 自定义能力 | 选图、主题名、标语、三种颜色、主题切换 | 固定 Miku 主题 | 固定高精度 Miku 主题与独立宠物 |
| 宠物 | 未提供原生配套宠物 | 覆盖内置 `Codex` 宠物槽 | 安装独立 `Miku Future`，不覆盖内置宠物 |
| 操作入口 | 桌面脚本、Finder 选图、可选 SwiftBar 菜单栏 | `.skill`、安装与恢复脚本 | `.skill`、一次退出自动安装、宠物独立安装 |
| 发布形态 | 仓库脚本与客户 ZIP 构建脚本，无 GitHub Release | GitHub Release 中有 `.skill` | 可复现打包脚本已补齐，尚未公开 |
| 许可证可见性 | MIT 只放在 `macos/`，GitHub 根仓未识别许可证，Windows 目录无独立许可证 | 根目录 MIT，GitHub 可识别 | 同左 |

## 三、技术路线的真实得失

### 1. Dream Skin 的优势

1. 不动 `app.asar`，不会直接破坏官方代码签名。
2. 同时有 macOS 与 Windows 实现，覆盖面明显更大。
3. 用户可自行选择图片、主题名称和颜色，更像一个主题生成器。
4. macOS 版提供 SwiftBar 菜单栏控制，可暂停、恢复、换图和切换主题。
5. 使用 Codex 应用内自带并已签名的 Node.js，用户不必另装 Node.js。
6. README 有中英文版本、多主题图库和客户 ZIP 交付入口，传播和非开发者安装路径更成熟。

### 2. Dream Skin 的代价

1. 必须让 Codex 以远程调试模式运行，并开放本机回环 CDP 端口。
2. CDP 本身没有应用层鉴权。本机不受信任程序在主题运行期间可能连接该端口，对方 README 和 NOTICE 也明确承认这一风险。
3. 注入器需要跨页面、刷新和路由变化持续工作，稳定性依赖 DOM 选择器和进程生命周期管理。
4. 它能做的是渲染器表层注入，无法像 ASAR 资源补丁那样自然替换低层资源槽和原生宠物资源。
5. 当前测试主要覆盖 Shell 语法、注入 payload、主题配置往返和 doctor 检查。公开仓库里没有与 Miku 项目同等细度的 ASAR 原子提交、竞态回滚和完整安装恢复矩阵，因为它本身不走 ASAR 路线。

### 3. Miku Theme 的优势

1. 主题一旦安装，Codex 可按普通方式运行，不需要常驻 CDP 端口或注入守护进程。
2. 可以替换固定资源槽，覆盖主画布、角色、侧栏纹理、拍立得和宠物，视觉一致性更强。
3. 安装器严格核对构建号、完整 ASAR 指纹、资源槽尺寸、备份哈希和提交前后状态。
4. 使用原子交换和 CAS 逻辑处理竞态，状态写入失败时可以回到安装前精确字节。
5. 公开版已有 6 个 Node 测试文件；本机 v5 已扩到 11 个测试文件，并增加分发同步、归档指纹、可复现打包、宠物气泡样式和 LaunchAgent 自清理验证。
6. 本机 v5 已把宠物从覆盖内置槽改成独立的 `Miku Future` 自定义宠物，这是对公开 v4 的实质改进。

### 4. Miku Theme 的代价

1. 修改了签名覆盖范围内的 `app.asar`，真实的 `codesign --verify --deep --strict` 会失败。
2. 只能支持经过实测的 Codex 构建，官方升级后必须重新适配，不能把版本常量改掉后强装。
3. 当前只支持 macOS，受众明显小于跨平台通用工具。
4. 固定 IP 主题的传播辨识度高，但用户无法像 Dream Skin 那样随手换任意图片。
5. 公开 GitHub 仍停在 v4，本机大量 v5 改进尚未推送。外部用户当前看到的仍是“覆盖内置 Codex 宠物槽”的旧状态。

## 四、代码与素材关系判断

### 1. 没有证据证明代码抄袭

两边的核心代码结构不同。

Dream Skin 主要是 Shell、JavaScript、CSS 和 PowerShell，核心围绕 CDP WebSocket、渲染器 payload、长期注入和跨平台启动。

Miku Theme 主要是 JavaScript 与 CSS，核心围绕 ASAR 索引解析、固定尺寸资源替换、完整指纹、原子提交、备份恢复和 Skill 打包。

仓库不是 GitHub fork 关系，主要文件、运行模型、状态目录和安装生命周期也不同。现有证据不支持“对方复制了你的代码”这个结论。

### 2. 初音未来图库图高度疑似来自同一图源

对方 `docs/images/gallery/skin-07.jpg` 与你公开仓库的 `assets/miku-reference.png` 在构图、文字、人物、卡片、侧栏条目和所有装饰细节上完全对应。

将你的 PNG 对齐到对方 JPEG 的 `1400×787` 尺寸后，测得：

1. SSIM：`0.925529`。
2. PSNR：`32.990411 dB`。

考虑到对方文件经过缩放和 JPEG 重编码，这已经是很强的同源证据。时间线上，你的仓库最后一个公开提交是 `2026-07-15T10:23:57Z`，对方初次公开提交是 `2026-07-15T14:18:08Z`，图库更新提交在 `14:29:44Z` 和 `14:52:18Z`。

但这里仍不能直接下“对方从你的仓库盗图”的结论。对方项目记录写明其来源包括“微信传播的 Win / Mac 皮肤包”，双方也可能拿到了同一份上游素材。当前能确认的是图像同源或近乎同源，不能仅凭公开时间证明唯一传播路径。

### 3. 对方素材归属说明存在空档

对方 `macos/references/asset-provenance.md` 只说明默认 `portal-hero.png` 是为项目生成的抽象图，没有逐项说明 README 图库 8 张效果图的来源。

其 `macos/NOTICE.md` 说明第三方角色和用户图片不在 MIT 授权范围内，但没有给 `skin-07.jpg` 单独署名。若你要交涉，最稳妥的问题是要求补充图库素材来源和署名，而不是先指控代码抄袭。

## 五、公开数据与时间线

核查时 GitHub 数据如下，数字会继续变化：

| 项目 | 创建时间 | 首次公开提交 | Star | Fork | 提交数 | Release |
| --- | --- | --- | ---: | ---: | ---: | --- |
| Codex Dream Skin | `2026-07-15T12:34:51Z` | `2026-07-15T14:18:08Z` | 67 | 16 | 11 | 无 |
| Codex Miku Theme | `2026-07-15T10:24:07Z` | 公开历史最早 `2026-07-15T06:28:28Z` | 17 | 9 | 7 | `v4.0.0` |

这些数字只能说明传播速度，不能直接说明代码质量。Dream Skin 的跨平台、任意换图、中文图库和赞助传播位更适合快速扩散；Miku 项目是垂直主题，目标人群更窄。

## 六、对你最有价值的下一步

### 优先级一：尽快公开 v5

这是当前最现实的短板。你的本地版本已经把公开版最容易被挑刺的“覆盖内置宠物”改成独立原生自定义宠物，还补了可复现打包、分发同步和一次性 LaunchAgent 自清理。只要它留在本地，外界对比时就看不到这些优势。

### 优先级二：把产品定位说透

不要把自己包装成另一个通用换肤器。更清晰的定位是：

> 为指定 Codex 构建提供高还原、全画布、原生宠物一体化主题，并用可验证的备份、指纹和原子回滚控制修改风险。

Dream Skin 卖“随便换图、跨平台、不改官方包”。你应该卖“视觉完成度、原生宠物、无需常驻 CDP、严格构建验证”。

### 优先级三：补素材来源说明

给 `miku-reference.png`、高清参考图、生成裁图和宠物素材补一份清晰的 provenance。写明哪些是用户提供、哪些是 AI 生成、哪些是裁剪产物，以及 MIT 不授予角色 IP 权利。这样遇到相同图库图时，你有更清楚的公开时间戳和来源声明。

### 优先级四：若要扩大用户面，再做 Lite 路线

可以另开 `CDP Lite` 模式，提供任意图片和不改签名的轻量主题，但不要用它替代现有 ASAR 版。两种模式分别服务不同风险偏好：

1. Lite：更新适应性更好、主题可换、需要 CDP。
2. Full：固定构建、高还原、原生宠物、修改签名资源。

## 七、来源

1. Dream Skin 仓库：https://github.com/Fei-Away/Codex-Dream-Skin
2. Dream Skin 项目记录：https://github.com/Fei-Away/Codex-Dream-Skin/blob/main/docs/PROJECT.md
3. Dream Skin macOS 说明：https://github.com/Fei-Away/Codex-Dream-Skin/blob/main/macos/README.md
4. Dream Skin 素材来源说明：https://github.com/Fei-Away/Codex-Dream-Skin/blob/main/macos/references/asset-provenance.md
5. Dream Skin NOTICE：https://github.com/Fei-Away/Codex-Dream-Skin/blob/main/macos/NOTICE.md
6. Dream Skin 初音图库图：https://github.com/Fei-Away/Codex-Dream-Skin/blob/main/docs/images/gallery/skin-07.jpg
7. Miku Theme 仓库：https://github.com/HeiGeAi/codex-miku-theme
8. Miku 参考图：https://github.com/HeiGeAi/codex-miku-theme/blob/main/assets/miku-reference.png
9. Miku v4 Release：https://github.com/HeiGeAi/codex-miku-theme/releases/tag/v4.0.0

## 八、核查边界

本报告基于 GitHub 公开 API、公开源码、提交时间线、仓库元数据和本机 Miku 开发工作区的静态核查。没有安装或运行 Dream Skin，也没有在 Windows 上做实机验收，因此不对其跨平台运行稳定性作绝对保证。
