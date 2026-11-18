/* eslint-disable no-console -- 示例程序直接显示解析结果。 */
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

import { parseEvent } from '@elysionjs/dylive-ws/parser';
import type { RawMessage } from '@elysionjs/dylive-ws/protocol';

import type { CaptureRecord } from '../scripts/jsonl';

function print(raw: RawMessage, roomId?: string): void {
  const result = parseEvent(raw, { roomId });

  if (result.status === 'parsed') {
    console.log(result.event);
  } else {
    console.log(result.status, result.raw.method, result.status === 'mismatch' ? result.issue : '');
  }
}

function parseLine(line: string): CaptureRecord {
  const record = JSON.parse(line) as CaptureRecord;

  if (
    record?.version !== 1 ||
    typeof record.roomId !== 'string' ||
    typeof record.raw?.method !== 'string' ||
    typeof record.raw.payload !== 'string'
  ) {
    throw new Error('不是 dylive-ws 采集记录');
  }

  const payload = Buffer.from(record.raw.payload, 'base64');

  if (payload.toString('base64') !== record.raw.payload) {
    throw new Error('载荷不是有效的 Base64');
  }

  return record;
}

async function replay(path: string): Promise<void> {
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;

  try {
    for await (const line of lines) {
      lineNumber++;

      if (!line.trim()) {
        continue;
      }

      const { raw, roomId } = parseLine(line);
      print(
        { method: raw.method, id: raw.id, payload: Buffer.from(raw.payload, 'base64') },
        roomId,
      );
    }
  } catch (error) {
    throw new Error(`回放失败 · 第 ${lineNumber} 行`, { cause: error });
  } finally {
    lines.close();
    input.destroy();
  }
}

const [path] = process.argv.slice(2);

if (path === '--help' || path === '-h') {
  console.log('bun examples/parse.ts [采集文件.jsonl]');
} else if (path) {
  await replay(path);
} else {
  const payload = await readFile(new URL('../src/testing/live/ChatMessage.bin', import.meta.url));
  print({ method: 'WebcastChatMessage', payload });
}
