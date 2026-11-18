# 直播客户端

`@elysionjs/dylive-ws` 提供 WebSocket 直连和 Electron 两种客户端。两者返回同一种 `LiveClient`，通过相同的 API 订阅事件、诊断和状态变化。

## WebSocket 直连

```ts
import { createClient } from '@elysionjs/dylive-ws';

await using client = createClient({
  roomId: '708764876300',
  cookie: async signal => cookieService.getCookie({ signal }),
});

client.on('event', event => console.log(event.user.name, event.content));
client.on('statusChange', status => console.log(status.status));
client.on('error', error => console.error(error.message));

await client.start();
```

`roomId` 是 `https://live.douyin.com/<roomId>` 末尾的网页直播间号。支持十进制字符串和安全整数。客户端从直播页读取内部房间号与访客标识，使用网页握手格式生成带签名的 WebSocket 地址，并处理心跳、ACK 和重连。连接后可通过 `getStatus().resolvedRoomId` 读取内部房间号。

`cookie` 可省略，默认使用网页返回的访客会话。提供 Cookie 时，可以传字符串或同步、异步函数，函数在每次建连前重新调用。需要接管 HTTP 请求时可传入 `fetch`，需要接管 WebSocket 创建时可传入 `createWebSocket(url, { headers })`。

已有可连接的地址时，可提供 `url` 或一个异步地址提供函数。此时会直接连接该地址，`roomId` 可作为事件缺少房间 ID 时的回退值。

WebSocket 地址属于抖音网页端协议，页面状态或握手格式变化会影响直连。Webcast 握手签名参考 [douyinLive 的 MIT 实现](https://github.com/jwwsjlm/douyinLive/blob/v2.3.2/internal/webcastsign/native.go)。

## Electron 主进程

```ts
import { createElectronClient } from '@elysionjs/dylive-ws/electron';
import { BrowserWindow } from 'electron';

const window = new BrowserWindow();
await window.loadURL('about:blank');

const client = createElectronClient({ webContents: window.webContents });
client.on('event', event => console.log(event.user.name, event.content));
client.on('error', error => console.error(error.message));
window.on('closed', () => void client.dispose());

try {
  await client.start();
  await window.loadURL('https://live.douyin.com/直播间号');
} catch (error) {
  await client.stop();
  throw error;
}
```

`electron` 是可选 peer dependency。调试器监听应在加载直播间之前启动。页面负责建立和维持 WebSocket 连接，`client.stop()` 释放网络监听和 debugger。窗口和登录会话由调用方管理。

## 生命周期

| 方法          | 行为                                               |
| ------------- | -------------------------------------------------- |
| `start()`     | 直连等待握手完成。Electron 等待网络监听就绪。      |
| `stop()`      | 停止当前会话。可再次调用 `start()`。               |
| `restart()`   | 等待当前会话停止，再启动新会话。                   |
| `dispose()`   | 停止会话并释放订阅。支持 `await using`。           |
| `getStatus()` | 返回房间、连接状态、重试次数和最后收到消息的时间。 |

Electron 收到第一批直播消息后进入 `connected`。页面关闭匹配的连接时回到 `connecting`，页面重连后会继续接收消息。

## 事件订阅

`client.on(name, handler)` 返回取消订阅函数。

| 事件             | 内容                         |
| ---------------- | ---------------------------- |
| `event`          | 类型化文字弹幕               |
| `raw`            | 原始 Protobuf 业务消息       |
| `unknownCommand` | 尚未识别的消息方法及原始载荷 |
| `schemaMismatch` | 已知消息的解析失败及原因     |
| `statusChange`   | 客户端状态快照               |
| `error`          | 会话、解包或订阅回调错误     |
