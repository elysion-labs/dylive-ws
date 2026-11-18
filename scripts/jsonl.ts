import { closeSync, fsyncSync, mkdirSync, mkdtempSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { RawMessage } from '../src';

export interface CaptureRecord {
  version: 1;
  receivedAt: string;
  roomId: string;
  webRoomId: string;
  authentication: 'anonymous' | 'authenticated';
  raw: Omit<RawMessage, 'payload'> & { payload: string };
}

export class JsonlWriter {
  readonly directory: string;
  private descriptor: number | undefined;
  private segmentBytes = 0;
  private segments = 0;
  private records = 0;

  constructor(
    base: string,
    private readonly maxBytes: number,
  ) {
    mkdirSync(base, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
    this.directory = mkdtempSync(join(base, `douyin-${stamp}-`));
  }

  write(record: CaptureRecord): void {
    const line = Buffer.from(`${JSON.stringify(record)}\n`);

    if (this.descriptor === undefined || this.segmentBytes + line.byteLength > this.maxBytes) {
      this.closeSegment();
      const number = String(this.segments + 1).padStart(6, '0');
      this.descriptor = openSync(join(this.directory, `events-${number}.jsonl`), 'wx', 0o600);
      this.segments++;
      this.segmentBytes = 0;
    }

    writeFileSync(this.descriptor, line);
    this.segmentBytes += line.byteLength;
    this.records++;
  }

  getStatus(): { segments: number; records: number } {
    return { segments: this.segments, records: this.records };
  }

  private closeSegment(): void {
    const descriptor = this.descriptor;
    this.descriptor = undefined;

    if (descriptor === undefined) {
      return;
    }

    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }

  [Symbol.dispose](): void {
    this.closeSegment();
  }
}
