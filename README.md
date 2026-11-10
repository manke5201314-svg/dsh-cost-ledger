# DSH 账本（dsh-cost-ledger）

给 [dsh-go](https://github.com/ccch1mneyyy/dsh-Go) 手机 App 的原生插件：**把「今天花了多少钱」放回你能看见的地方。**

它的全部计算都在本机完成——读 DSH 自己的会话日志，按 DeepSeek 官方价目把 token 用量折成人民币。不联网、不读凭据、不碰消息正文。

## 功能

| 位置 | 效果 |
|---|---|
| 输入框上方 | 常驻一行「今日 ¥1.39」，点按打开账本 |
| 账本面板 | 今日 / 本月 / 本次会话花费、最近 7 天柱状图、按模型明细、累计花费 |
| 每条回复下方 | 回合脚注「本轮 ¥0.08」 |
| 长按助手回复 | 「这条花费」，附输入 / 输出 token |

## 为什么值得装

插件生态里「用量 / 计费」是出现最密集的实用类需求（同类插件 8+ 个，头部 6k+ star），而 dsh-go 手机端此前没有这个能力。手机上看不见消耗，是账单焦虑的源头。

## 安装

要求：dsh-go 手机 App（本机引擎），dsh ≥ 0.2.1-rc.2，桥接协议 v1。

```sh
git clone https://github.com/manke5201314-svg/dsh-cost-ledger.git
dsh plugin --profile web add ./dsh-cost-ledger
```

然后在 App 的「引擎」页重启一次引擎（或重开 App）。新插件由引擎启动时加载。

## 计费口径

- 数据来源：本机 `$DSH_HOME/sessions/**/session.v4.jsonl.zstd` 里 `assistant/message` 事件的 `usage`（输入、缓存命中、输出 token）。
- 单价：DeepSeek 官方价目表，含 2026-05-22 的 V4 永久降价与 2026-08-17 起的**峰谷价**（峰时 09:00–12:00 / 14:00–18:00，北京时间，谷时半价）。
- 只统计 DeepSeek 模型（`deepseek*`）；其他模型不会进入统计。
- 数值是**按 API 价估算**，不等于账号实际扣费（订阅、赠送额度等不计）。
- 价目表变化时，改 `lib/pricing.js` 里的 `POLICIES` 即可。

## 隐私

- 只读本机会话日志里的 token 计数与时间戳，不读取、不发送消息内容。
- 不联网：插件只做本地文件读取与算术。
- 不读取任何 API Key 或账号凭据。

## 已知限制

- 只统计**这台主机**上的会话日志；连的是远程主机时，读不到那台机器的日志。
- 会话很多时首次统计会慢几秒，之后按日志 revision 增量刷新。
- 页面关闭后 CPU 占用为零（数据流随订阅自动停止）。

## 卸载

```sh
dsh plugin --profile web remove dsh-cost-ledger
```

再删掉克隆下来的目录即可。

## License

MIT
