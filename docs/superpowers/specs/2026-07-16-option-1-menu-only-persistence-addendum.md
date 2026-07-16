# 方案 1：顶部菜单唯一开启常驻入口

日期：2026-07-16

状态：已确认，覆盖旧设计中的冲突内容

## 决策

用户选择严格方案 1：只有 Codex 顶部菜单中的「皮肤常驻」开关可以把 `persistenceEnabled` 从 `false` 改为 `true`。

关闭开关后的契约固定为：

1. 当前精确 Codex 进程继续保留皮肤与菜单。
2. 当前进程退出后，后台控制器注销；下次普通启动使用完全原生前端。
3. macOS「HeiGe 皮肤启动器」、Windows 开始菜单入口、`apply`、兼容名 `enable-skin` 和自然语言「启用皮肤」都只恢复当前会话，不改变常驻选择。
4. 用户若希望以后启动仍自动恢复皮肤，必须在已拉起的当前会话中重新打开顶部开关。
5. `set-persistence true` 不再是用户命令。公开 CLI 只保留 `set-persistence false` 作为关闭手段。

## 可信内部例外

以下动作不是公开的重新开启入口：

1. 已加载旧 watchdog 的一次性迁移可以保留用户升级前已经存在的常驻选择。
2. 经过严格路径、事务 ID、revision、control token 和 journal 校验的安装或迁移恢复，可以完成被中断的既有事务。
3. controller 可以恢复已经 durable commit、但因进程死亡尚未完成的 transition journal。

这些内部路径不得通过普通 CLI 参数、环境布尔值或公开脚本触发。新安装仍默认 `persistenceEnabled=false`。

## 入口矩阵

| 入口 | 当前会话应用皮肤 | 可开启常驻 |
|---|---:|---:|
| 顶部「皮肤常驻」开关 | 是 | 是 |
| macOS「HeiGe 皮肤启动器」 | 是 | 否 |
| Windows 开始菜单「HeiGe 皮肤启动器」 | 是 | 否 |
| `apply` | 是 | 否 |
| 兼容名 `enable-skin` | 是 | 否 |
| 弃用入口 `enable-persist.command` | 否，非零退出 | 否 |
| 自然语言「启用皮肤」 | 是 | 否 |
| `set-persistence false` | 不适用 | 只能关闭 |
| 可信安装／迁移恢复 | 按事务恢复 | 仅恢复既有事务 |

## 菜单提醒

关闭确认和成功提醒都必须同时说明两件事：

1. 「HeiGe 皮肤启动器」只恢复本次皮肤。
2. 下次仍需常驻时，重新打开顶部开关。

关闭后的完整恢复步骤是：先用本地启动器或「启用皮肤」恢复当前会话，再由用户在顶部菜单显式打开常驻开关。任何启动器、Skill 或兼容脚本都不得代替第二步。

后台 ACK 返回前不得先改变开关显示。ACK 失败时保留旧状态并显示安全、可操作的错误。

## 主题选择

正式主题选择必须通过带 control token、revision 和 CAS 的本机控制端点提交。renderer 收到权威 ACK 后才应用并同步到其他窗口。

顶部「自定义图片」是单个本地快捷槽位，不写入权威 `lastNonNativeThemeId`，也不把快捷图片冒充为可分发或可长期管理的正式主题。renderer 本地存储可在自动补针或常驻启动时继续显示该快捷图，这不改变启动器记录的最近正式主题。用户需要长期管理时使用 `create` 或 `customize` 创建正式主题。

## 失败语义

1. 需要从 closed 或 native 前态拉起 CDP 的流程必须记录精确前态。
2. continuation 失败时恢复到原 closed 或 native 状态，并写入仅当前用户可读的原子结果回执。
3. macOS 图形入口显示安全错误；Windows 脚本保持非零退出码与可见错误。
4. `pause` 和 `restore` 只有在皮肤移除成功后才能发布 paused 或 restoring session，避免失败后控制器误以为清理已经完成。

## 覆盖关系

本文覆盖《审计加固与用户可控常驻设计》中以下冲突内容：

1. 4.3 中「重新启用会安装后台任务」。
2. 8.2 中 `enable-skin` 写入 `persistenceEnabled=true`。
3. 8.5 中 `enable-persist.command` 开启常驻。
4. 9.1、9.2 中启动器指向持久化启用入口。
5. 9.3 中把「启用皮肤」与「开启常驻」视为同一自然语言意图。
6. 任何允许菜单以外的公开入口把常驻从关闭改为开启的描述。

`enable-persist.command` 的当前语义为安全的非零弃用入口，不是 session-only alias，也不做任何皮肤或常驻状态变更。
