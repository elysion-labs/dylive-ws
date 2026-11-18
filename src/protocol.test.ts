import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parseEvent } from './parser';
import { decodeCdpPayload, decodeMessages } from './protocol';
import expected from './testing/expected.json';
import { bytesField, numberField, pushFrame } from './testing/frames';
import electronCapture from './testing/live/electron/manifest.json';

const samples = Object.keys(expected).map(name => ({
  method: `Webcast${name}`,
  payload: new Uint8Array(readFileSync(new URL(`./testing/live/${name}.bin`, import.meta.url))),
}));

describe('Douyin protocol', () => {
  it('replays anonymized chat sampled from Electron', () => {
    const raws = electronCapture.fixtures.map(fixture => {
      const file = new URL(`./testing/live/electron/${fixture.file}`, import.meta.url);
      const payload = readFileSync(file);
      const hash = createHash('sha256').update(payload).digest('hex');

      expect(hash).toBe(fixture.sha256);

      return { method: electronCapture.method, payload };
    });

    const messages = decodeMessages(pushFrame(raws, 'gzip'));
    expect(messages).toHaveLength(electronCapture.fixtures.length);

    for (const [index, fixture] of electronCapture.fixtures.entries()) {
      const result = parseEvent(messages[index], { roomId: fixture.room });
      expect(result).toMatchObject({ status: 'parsed', event: fixture.expected });
    }
  });

  it.each(['none', 'gzip', 'gzip-no-header'] as const)(
    'replays captured payloads through a %s frame',
    compression => {
      const frame = pushFrame(samples, compression);
      const messages = decodeCdpPayload(frame.toString('base64'));

      expect(messages.map(raw => raw.method)).toEqual(samples.map(raw => raw.method));

      for (const [index, raw] of messages.entries()) {
        expect(raw.payload).toEqual(samples[index].payload);
        const { raw: original, ...result } = parseEvent(raw, { roomId: 'example-room' });
        expect(original).toBe(raw);
        expect<unknown>(result).toEqual(Object.values(expected)[index]);
      }
    },
  );

  it('preserves 64-bit IDs on every layer', () => {
    const common = Buffer.concat([
      numberField(2, 18_446_744_073_709_551_610n),
      numberField(3, 9_007_199_254_740_993n),
      numberField(4, 1_789_000_000_000n),
    ]);

    const user = Buffer.concat([numberField(1, 9_007_199_254_740_995n), bytesField(3, '测试昵称')]);

    const payload = Buffer.concat([
      bytesField(1, common),
      bytesField(2, user),
      bytesField(3, '弹幕'),
    ]);

    const frame = pushFrame([
      { method: 'WebcastChatMessage', payload, id: '18446744073709551611' },
    ]);

    const [raw] = decodeMessages(frame);
    const result = parseEvent(raw, { roomId: 'fallback-room' });

    expect(result).toMatchObject({
      status: 'parsed',
      event: {
        id: '18446744073709551611',
        roomId: '9007199254740993',
        platformTime: '1789000000000',
        user: { id: '9007199254740995', name: '测试昵称' },
        content: '弹幕',
      },
    });
  });

  it('ignores control frames and surfaces invalid inputs', () => {
    const heartbeat = Buffer.concat([bytesField(7, 'hb'), bytesField(8, 'ping')]);

    expect(decodeMessages(heartbeat)).toEqual([]);
    expect(() => decodeCdpPayload('%%%%')).toThrow('Base64');
    expect(() => decodeMessages(Uint8Array.of(0x42, 0x05, 0x02))).toThrow('Truncated');
    expect(parseEvent({ method: 'WebcastChatMessage', payload: new Uint8Array() })).toMatchObject({
      status: 'mismatch',
      issue: 'Missing chat text in protobuf field 3',
    });
  });
});
