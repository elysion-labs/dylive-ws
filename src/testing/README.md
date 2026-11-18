# 真实数据回归

## 样本来源

- `live/electron/` 保存 2026 年 11 月 18 日通过 Electron 从抖音直播页收到的文字弹幕。发布样本保留可公开的普通文字及部分协议字段，移除了房间 ID、消息 ID、用户 ID、时间和其他元数据。昵称已替换，可能识别个人身份的弹幕文本也会替换。
- `live/` 顶层的 `ChatMessage.bin`、`EmojiChatMessage.bin`、`RoomStatsMessage.bin` 来自 [opedium/douyin-live-proto 的脱敏实采样本](https://github.com/opedium/douyin-live-proto/tree/d3b2d9c05513e3a34096c28f1213a171ce882b5e/sampled_payload)。源项目声明使用 MIT 许可证。

## 回放

`live/electron/manifest.json` 记录文件哈希、匿名房间分组和预期事件。顶层公开样本的预期结果记录在 `expected.json`。

测试将业务载荷封入本地构造的 PushFrame，以覆盖明文和 gzip 解包。业务载荷来自真实采样，外层 WebSocket 消息由测试构造。合成用例还覆盖 64 位 ID、坏帧和客户端生命周期。

运行 `bun test` 即可离线回放。
