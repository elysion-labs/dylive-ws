# JSONL 采集

采集使用正式 WebSocket 客户端，将收到的原始 Protobuf 业务消息逐条写入 JSONL。已知消息、未知消息和格式不匹配的消息都会记录。HTTP 响应、Cookie、带签名的连接地址、心跳和 ACK 均不写入。

```sh
vp run capture
vp run capture:anonymous 708764876300
```

在项目根目录运行。房间号可在命令末尾传入，支持用空格或逗号分隔。未传房间号时使用环境变量 `DOUYIN_ROOM_IDS`。两个 Vite Task 都禁用缓存，也可直接运行 `bun scripts/capture.ts`，传入 `--anonymous` 强制使用访客态。

## 配置

Bun 会读取项目的 `.env`。以下字段均可通过环境变量设置：

```dotenv
DOUYIN_ROOM_IDS=708764876300,79454785949
# 可选。不设置时以访客身份连接。
DOUYIN_COOKIE=
# 0 表示持续运行。时长包含连接与重连等待。
DOUYIN_CAPTURE_SECONDS=30
DOUYIN_CAPTURE_OUTPUT=.captures
DOUYIN_CAPTURE_MAX_BYTES=67108864
```

默认按 64 MiB 分段，单条记录超过上限时会独占一个分段。每次运行建一个独立的 `douyin-<启动时间>-<随机后缀>` 目录，记录写入 `events-000001.jsonl` 等文件。Ctrl+C 或 SIGTERM 会停止所有客户端，再同步并关闭文件。文件写入失败时，以非零状态退出。

## 每行格式

```ts
interface CaptureRecord {
  version: 1;
  receivedAt: string;
  roomId: string;
  webRoomId: string;
  authentication: 'anonymous' | 'authenticated';
  raw: {
    method: string;
    id?: string;
    payload: string;
  };
}
```

`receivedAt` 是本机收到消息的 UTC 时间，`webRoomId` 是网页直播间号，`roomId` 是解析出的平台内部房间号。`raw.payload` 为原始 Protobuf 载荷的 Base64，可能包含观众昵称、标识和弹幕内容。

## 回放

```sh
vp run build
bun run example:parse
bun examples/parse.ts .captures/douyin-某次采集/events-000001.jsonl
```

默认示例解析仓库里的脱敏样本。传入 JSONL 文件后，示例逐行解码并调用同一个 `parseEvent()`。采集文件留在本地，选中并脱敏的样本才加入 [回归样本](../src/testing/README.md)。

WebSocket 监听示例可通过 `DOUYIN_EXAMPLE_SECONDS` 设置运行时长，设为 `0` 时用 Ctrl+C 停止。Electron 示例通过 `bunx electron examples/electron.mjs [网页直播间号]` 启动，可在窗口内登录和切房。
