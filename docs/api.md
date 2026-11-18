# @elysionjs/dylive-ws

这里说明二进制协议入口与独立解析器。连接、心跳和重连见 [客户端文档](./client.md)。

## 二进制协议

`@elysionjs/dylive-ws/protocol` 的 `decodeMessages()` 接收一条完整的二进制 WebSocket 消息，处理 gzip 并返回原始消息列表。消息包含 `method`、`payload` 和可选的 `id`。

## 无状态解析

```ts
import { parseEvent } from '@elysionjs/dylive-ws/parser';
import { decodeMessages } from '@elysionjs/dylive-ws/protocol';

for (const raw of decodeMessages(bytes)) {
  const result = parseEvent(raw, { roomId: '123456789' });

  switch (result.status) {
    case 'parsed':
      console.log(result.event);
      break;
    case 'unknown':
      console.log('未知消息方法', result.raw.method);
      break;
    case 'mismatch':
      console.log('格式异常', result.issue);
      break;
  }
}
```

原始业务消息通过 `result.raw` 保留。消息、用户和房间 ID 用字符串表示，保留 64 位精度。`platformTime` 保留平台时间字段的十进制原值。
