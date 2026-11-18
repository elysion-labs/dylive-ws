<h1 align="center">dylive-ws</h1>

<p align="center">把抖音直播间里的文字弹幕变成可以监听、解析与回放的事件。</p>

<p align="center">
  <a href="#quick-start">快速开始</a> ·
  <a href="#events">支持事件</a> ·
  <a href="#snapshots">真实数据回归</a> ·
  <a href="./docs/client.md">客户端文档</a> ·
  <a href="./docs/api.md">API 文档</a>
</p>

`@elysionjs/dylive-ws` 读取抖音直播消息，保留原始 Protobuf 载荷，并将文字弹幕转换为类型化事件。WebSocket 直连和 Electron 客户端共用事件解析、诊断和生命周期。

## 现在可以做什么？

- **直连 WebSocket** — 从网页直播间号获取连接地址，处理心跳、ACK 和断线重连。
- **在 Electron 里监听** — 读取直播页收到的消息，使用页面现有的会话。
- **独立解析与回放** — 解包后保留原始消息，支持离线回放脱敏实采载荷。

<a id="quick-start"></a>

## 快速开始

从源码安装依赖并构建：

```sh
bun install --frozen-lockfile
vp run build
```

把直播间网址末尾的数字作为 `roomId`，即可从 Bun 或 Node.js 直连：

```ts
import { createClient } from '@elysionjs/dylive-ws';

await using client = createClient({ roomId: '708764876300' });

client.on('event', event => console.log(event.user.name, event.content));
client.on('error', error => console.error(error.message));

await client.start();
```

如果已经在 Electron 中打开直播页，使用 `@elysionjs/dylive-ws/electron` 的 `createElectronClient()`。完整示例、Cookie 与状态语义见 [客户端文档](./docs/client.md)。

<a id="events"></a>

## 支持的事件

| 命令                 | 事件类型  | 内容                           |
| -------------------- | --------- | ------------------------------ |
| `WebcastChatMessage` | `message` | 文字弹幕、昵称、消息和房间标识 |

未识别的直播消息通过 `unknownCommand` 暴露为原始消息。已知消息无法解析时，可以通过 `schemaMismatch` 查看原因。独立解析和解包见 [API 文档](./docs/api.md)。

<a id="snapshots"></a>

## 真实数据回归

```sh
vp check
bun test
vp run typecheck
```

测试可以离线运行。样本来源和回放方式见 [回归样本说明](./src/testing/README.md)。
