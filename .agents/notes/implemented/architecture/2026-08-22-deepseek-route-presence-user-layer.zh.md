# Agent Note: DeepSeek 路由的存在性由用户层数据决定

Status: implemented

[English](2026-08-22-deepseek-route-presence-user-layer.md) | 中文

## Problem

DeepSeek 官方路由在结构上不可删除。它的 settings namespace 本身就是 profile（`settingsPath: []`），而 `installSettingsSection` 总是把组合条目作为 `base` 层安装并应用 schemastery 默认值，因此 profile 每次启动都会解析成功：配置界面永远把它渲染成已配置，删除按钮永远不会出现，首次运行引导还会向每个未配置密钥的用户索要官方凭据——哪怕他们只打算使用其他提供方。相对每一条出厂休眠、由用户添加后才成行、且始终可删除的 pi-ai catalog 路由，DeepSeek 被特殊化了。

## Decision

`llm-deepseek` 的 settings 分节改为按路由键控的 provider profile 字典——与 `llm-pi-ai` 相同的形状——本适配器只服务 `deepseek-official` 这一个键；其他任何键都会被分节校验器在写入处拒绝，而不是被静默忽略。

存在性跟随分层：

- 不固定任何 profile 的组合以**休眠**姿态组合：不注册任何适配器路由，同时目录条目仍向配置界面提供 DeepSeek。
- 通过任意配置界面（Web 模型页或 `settings.yaml`）添加该路由，会把 `providers.deepseek-official` 存入用户层；此后该行与用户新增的 pi-ai 路由完全一样，可编辑、可删除。删除即撤回路由。
- 启动环境能够应答该 profile 凭据引用（默认 `DEEPSEEK_API_KEY`）时，路由自行注册，因此文档承诺的开箱即用 CLI 体验（导出 `DEEPSEEK_API_KEY`、零存储配置）保持不变。

字典形状是承重的，不是风格偏好：schemastery 会把被寻址的嵌套*对象*连同其 schema 默认值具化进每一份解析后的分节值，所以一旦挂载了 settings 服务，对象形状的 `provider` 键永远无法读作缺席。只有「键不存在」的字典才能在解析后仍然区分缺席。

伴随同一刀，Web 模型页失去了它为整分节提供方准备的所有特例：设置卡姿态（提供方渲染成常开的卡片）、首次运行凭据弹窗背后的就绪投影、以及那个弹窗本身都不复存在。启动时没有任何步骤索要任何提供方凭据；欢迎声明是唯一的引导步骤。

只要编辑器存入密钥，就会把派生的 `<ROUTE>_API_KEY` 引用写进存储的 profile——两个家族都如此。对 DeepSeek 而言，这让页面存的引用（`DEEPSEEK_OFFICIAL_API_KEY`）从此成为请求期解析读取的那个引用，也正因如此，删除时才能精确移除页面存入的那份凭据。

## Alternatives considered

- **保留整分节 profile，放宽 UI 联接里的 `removable`／`configured`。** 否决：base 层仍会在每次启动解析出完整内容，「已删除」永远无法表示；UI 将在对分层状态说谎。
- **用普通嵌套 `provider` 对象而非字典。** 在实现尝试后否决：schemastery 会把缺席的嵌套对象连同默认值具化进解析值，一旦 settings 服务挂载，休眠便不可检测。字典中键的缺席才是唯一能在解析后幸存的缺席信号。
- **把 `llm-deepseek` 从默认组合中整个移除**，让任何 DeepSeek 特有内容都不随包分发。否决：没有目录条目，Models 页无法再把 DeepSeek 提供回来，原生适配器（视觉 Files 管线）会从所有人手中消失，而不是进入休眠。
- **凭据服务而非启动环境来门控注册。** 否决：seam 异步解析且可能完全缺席（headless 组合），而环境快照是同步的，且本来就是该引用文档化的回退平面。

## Consequences

全新的无密钥部署只会把 DeepSeek 看作一个可添加条目，首次运行凭据弹窗不复存在于任何地方。固定 `providers.deepseek-official` 的组合保持今天的常开行为，并且因为归组合所有而正确地不可删除。用户删除存储的 profile 后若环境仍导出 `DEEPSEEK_API_KEY`，行会消失但路由继续服务——环境仍然是配置，README 已写明这一点。通过旧弹窗在 `DEEPSEEK_API_KEY` 下存过密钥的既有部署会继续工作，直到他们在 UI 中重新输入密钥，届时引用迁移到 `DEEPSEEK_OFFICIAL_API_KEY`；删除确认框会点名将要移除的凭据。

验证：`dynamic-config.spec.ts` 以真实 settings/credential 提供方钉住启动休眠、添加即注册、删除即撤回与环境凭据注册；`loader-composition.spec.ts` 经 Loader 启动字典形状；`store.client.spec.ts` 联接休眠／组合固定／用户存储三种姿态；两个重写的浏览器场景端到端演练带钥添加、确认删除与无提示启动。
