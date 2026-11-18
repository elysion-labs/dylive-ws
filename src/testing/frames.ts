import { gzipSync } from 'node:zlib';

import type { RawMessage } from '../protocol';

function varint(input: bigint): number[] {
  let value = input;
  const bytes: number[] = [];

  while (value > 0x7fn) {
    bytes.push(Number(value & 0x7fn) | 0x80);
    value >>= 7n;
  }

  bytes.push(Number(value));

  return bytes;
}

export function numberField(field: number, value: bigint): Buffer {
  return Buffer.from([...varint(BigInt(field) << 3n), ...varint(value)]);
}

export function bytesField(field: number, value: string | Uint8Array): Buffer {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  const tag = varint((BigInt(field) << 3n) | 2n);
  const length = varint(BigInt(bytes.length));

  return Buffer.concat([Buffer.from([...tag, ...length]), bytes]);
}

export function pushFrame(
  messages: RawMessage[],
  compression: 'none' | 'gzip' | 'gzip-no-header' = 'none',
): Buffer {
  const response = Buffer.concat(
    messages.map(raw => {
      const envelope = [bytesField(1, raw.method), bytesField(2, raw.payload)];

      if (raw.id) {
        envelope.push(numberField(3, BigInt(raw.id)));
      }

      return bytesField(1, Buffer.concat(envelope));
    }),
  );

  const payload = compression === 'none' ? response : gzipSync(response);
  const fields = [bytesField(7, 'msg'), bytesField(8, payload)];

  if (compression === 'gzip') {
    fields.unshift(bytesField(6, 'gzip'));
  }

  return Buffer.concat(fields);
}
