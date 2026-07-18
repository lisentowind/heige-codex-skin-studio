# 阅读增强设计规格

## 目标

为启用皮肤后的 AI 回复正文提供稳定的主题自适应底色，降低复杂背景对文字可读性的影响。功能默认开启，用户可以在主题中心关闭，选择在重启和重新注入后继续保留。

## 范围

本次只包含两个紧密相关的交付项：

1. 阅读增强开关、样式、持久化和同窗口同步。
2. 修复正式发布包将可执行 `.zsh` 文件错误打包为 `0644` 的回归。

不增加新的后台接口，不修改控制器状态格式，不增加主题清单字段，不引入第三方依赖，不增加图片分析任务。

## 方案比较

### 方案一：大面积实时高斯模糊

在 AI 回复容器上使用 `backdrop-filter`。视觉上最接近磨砂玻璃，但长对话滚动时可能扩大 GPU 重绘区域，不符合「不卡顿」的最高优先级。

### 方案二：主题自适应半透明底色

使用现有 `--heige-surface` 和 `--heige-text` 变量，为 AI 回复容器增加高不透明度的半透明底色、细边框和轻阴影，不启用大面积模糊。浅色主题自然接近白色玻璃底，深色主题自然使用深色底。

这是采用的方案。它复用现有主题色，不增加运行时计算和额外 DOM。

### 方案三：每段消息独立卡片

为回复中的段落、代码块和工具结果分别寻找或创建卡片。控制精细，但依赖更多不稳定选择器，增加 DOM 和维护成本，不符合产品轻量约束。

## 交互

主题中心底部增加「阅读增强」开关，与「皮肤常驻」并列但语义独立。

开关规则：

1. 首次使用或本地值缺失时默认开启。
2. 关闭后立即恢复当前版本的透明 AI 回复区。
3. 再次开启后立即恢复主题自适应底色。
4. 开关支持鼠标、Enter 和 Space。
5. 状态通过 `aria-checked` 暴露，并提供简短说明。
6. 状态写入 `localStorage`，键名为 `heigeCodexReadabilityEnabled`。
7. 多 renderer 使用现有 `heige-codex-skin-v2` BroadcastChannel 同步。
8. `storage` 事件作为同源窗口的补充同步路径。

## 样式

基础规则继续保证关闭状态下 AI 回复区完全透明。

开启状态通过根节点属性 `data-heige-readability="on"` 激活：

```css
:root[data-heige-readability="on"] [data-local-conversation-final-assistant] {
  color: var(--heige-text) !important;
  background: color-mix(in srgb, var(--heige-surface) 86%, transparent) !important;
  border: 1px solid color-mix(in srgb, var(--heige-accent) 18%, transparent) !important;
  border-radius: 18px;
  box-shadow: 0 8px 26px color-mix(in srgb, var(--heige-text) 10%, transparent) !important;
  backdrop-filter: none !important;
}
```

不增加 padding，不改变消息排版宽度，不给每条子内容增加新节点。

## 状态和清理

renderer 初始化时读取本地值。只有精确字符串 `"0"` 表示关闭，其余情况均按默认开启处理。切换时写入 `"1"` 或 `"0"`，并更新 `document.documentElement.dataset.heigeReadability`。

重新注入时新 generation 接管属性。移除皮肤时清除由当前 runtime 设置的属性，不影响用户保存的偏好。

BroadcastChannel 新增 `kind: "readability"`，值必须为布尔值。旧 generation 收到无法识别的消息时继续忽略，不扩展后台信任边界。

## 性能约束

1. 不在 AI 回复区使用 `backdrop-filter`。
2. 不使用 MutationObserver。
3. 不增加滚动、输入或 resize 监听。
4. 每次切换只修改一个根节点属性、一个本地存储值并发送一条广播。
5. 不增加网络请求或控制器请求。

## 发布包权限修复

打包器当前只为 `.command` 设置 `0755`，导致 Git 中为 `0755` 的 `scripts/lib/run-cli.zsh` 在归档中变成 `0644`。正式包安装后，所有调用该 wrapper 的 macOS 入口都会失败。

打包器应将 `.command` 和 `.zsh` 都固定为 `0755`。测试必须检查归档中的 `run-cli.zsh` 和 `launch-codex.zsh` 权限，并验证解压后的 `apply.command` 能实际执行 wrapper。

## 验收标准

1. 本地值缺失时，阅读增强开关显示开启，AI 回复区出现主题自适应底色。
2. 关闭后立即透明，刷新或重新注入后仍关闭。
3. 再次开启后立即恢复，浅色和深色主题均保持文字对比。
4. 两个 renderer 的开关状态同步，远端消息不回声。
5. 关闭阅读增强不改变皮肤常驻状态。
6. AI 回复区计算样式不包含模糊滤镜。
7. 全量测试通过。
8. 新构建发布包中的 `.command` 和 `.zsh` 均为 `0755`。
9. 从新构建包安装后，`apply.command` 可正常应用主题。

