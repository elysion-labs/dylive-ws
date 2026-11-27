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

## 事件类型

`result.event` 与客户端的 `event` 回调都是 `LiveEvent`，按 `type` 区分：

| `type`     | 来源方法                 | 含义                         |
| ---------- | ------------------------ | ---------------------------- |
| `message`  | `WebcastChatMessage`     | 文字弹幕                     |
| `gift`     | `WebcastGiftMessage`     | 送礼                         |
| `member`   | `WebcastMemberMessage`   | 进入直播间                   |
| `like`     | `WebcastLikeMessage`     | 点赞                         |
| `follow`   | `WebcastSocialMessage`   | 关注主播（仅 `action` 为 1） |
| `fansclub` | `WebcastFansclubMessage` | 加入或升级粉丝团             |

`WebcastSocialMessage` 中关注以外的动作、未识别类型的粉丝团消息返回 `unknown`，原始载荷仍在 `raw` 中。

可选属性在消息缺少对应字段时为 `undefined`。

### 公共属性

每种事件都有以下属性：

| 属性           | 类型                  | 说明                                                           |
| -------------- | --------------------- | -------------------------------------------------------------- |
| `type`         | 字符串字面量          | 事件类型，见上表                                               |
| `user`         | `LiveUser`            | 触发事件的用户：发弹幕、送礼、进场、点赞、关注或加入粉丝团的人 |
| `id`           | `string \| undefined` | 消息 ID，优先取外层消息 ID，其次取通用头 `msg_id`              |
| `roomId`       | `string \| undefined` | 内部房间 ID，缺失时回退到 `ParseContext.roomId`                |
| `platformTime` | `string \| undefined` | 平台时间字段的十进制原值                                       |

### `LiveUser`

| 属性       | 类型                                           | 说明                                                                  |
| ---------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| `name`     | `string`                                       | 昵称，缺失时为空字符串                                                |
| `id`       | `string \| undefined`                          | 用户 ID，优先取字符串形式的 `id_str`                                  |
| `payLevel` | `number \| undefined`                          | 财富等级，等级为 0 时省略                                             |
| `fansClub` | `{ name: string; level: number } \| undefined` | 当前佩戴的粉丝团灯牌，等级为 0 时省略。实采数据中 `name` 常为空字符串 |

### `message` 文字弹幕

| 属性      | 类型     | 说明     |
| --------- | -------- | -------- |
| `content` | `string` | 弹幕文本 |

### `gift` 送礼

| 属性                | 类型                    | 说明                                           |
| ------------------- | ----------------------- | ---------------------------------------------- |
| `gift.id`           | `string`                | 礼物 ID，缺失时整条消息返回 `mismatch`         |
| `gift.name`         | `string \| undefined`   | 礼物名称，来自消息内附带的礼物目录             |
| `gift.diamondCount` | `number \| undefined`   | 单个礼物的钻石价值                             |
| `gift.combo`        | `boolean`               | 礼物目录标记为可连击                           |
| `gift.fansClub`     | `boolean`               | 粉丝团专属礼物                                 |
| `groupId`           | `string \| undefined`   | 连击组 ID，同一连击组的推送共用                |
| `groupCount`        | `number`                | 每次送出的个数，缺失时为 1                     |
| `repeatCount`       | `number`                | 重复次数，缺失时为 1                           |
| `comboCount`        | `number`                | 当前连击数，缺失时为 1                         |
| `totalCount`        | `number \| undefined`   | 平台给出的累计个数                             |
| `repeatEnd`         | `boolean`               | 是否为连击组的结束推送                         |
| `recipient`         | `LiveUser \| undefined` | 团播等场景里指定的接收人，没有昵称和 ID 时省略 |

可连击礼物会在同一 `groupId` 下多次推送。只想计一次时，通常可在 `!gift.combo || repeatEnd` 时累计 `comboCount * groupCount`。

### `member` 进入直播间

| 属性          | 类型                  | 说明                                        |
| ------------- | --------------------- | ------------------------------------------- |
| `memberCount` | `number \| undefined` | 平台随进场消息下发的当前人数，不属于 `user` |

进场的观众在公共属性 `user` 里。

### `like` 点赞

| 属性    | 类型                  | 说明                   |
| ------- | --------------------- | ---------------------- |
| `count` | `number`              | 本次点赞数，缺失时为 1 |
| `total` | `number \| undefined` | 直播间累计点赞数       |

### `follow` 关注主播

| 属性          | 类型                  | 说明           |
| ------------- | --------------------- | -------------- |
| `followCount` | `number \| undefined` | 主播当前关注数 |

### `fansclub` 粉丝团

| 属性      | 类型                  | 说明                                             |
| --------- | --------------------- | ------------------------------------------------ |
| `action`  | `'join' \| 'upgrade'` | `join` 为加入粉丝团，`upgrade` 为粉丝团升级      |
| `content` | `string \| undefined` | 平台下发的提示文本，如“恭喜 xxx 成为第 n 名成员” |
