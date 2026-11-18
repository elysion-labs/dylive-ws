import type { LiveClient } from '../src';

export function roomIds(values: readonly string[]): string[] {
  const ids = [...new Set(values.flatMap(value => value.split(',')).map(value => value.trim()))];

  if (!ids.length || ids.some(id => !/^[1-9]\d{0,19}$/.test(id))) {
    throw new Error('请传入网页直播间号，或设置 DOUYIN_ROOM_IDS');
  }

  return ids;
}

export function integer(
  value: string | undefined,
  fallback: number,
  label: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const number = value === undefined ? fallback : Number(value);

  if (
    (value !== undefined && !/^\d+$/.test(value)) ||
    !Number.isSafeInteger(number) ||
    number < min ||
    number > max
  ) {
    throw new Error(`${label} 必须是 ${min} 到 ${max} 之间的整数`);
  }

  return number;
}

export async function runLiveClients(
  clients: readonly LiveClient[],
  seconds: number,
  controller = new AbortController(),
): Promise<void> {
  const interrupt = () => controller.abort();
  const { signal } = controller;
  const done = Promise.withResolvers<void>();
  const onAbort = (): void => done.resolve();

  const unsubscribe = clients.map(client =>
    client.on('statusChange', state => {
      if (state.status === 'failed') {
        controller.abort(new Error(`直播间 ${state.roomId} 结束连接`));
      }
    }),
  );

  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  signal.addEventListener('abort', onAbort, { once: true });
  const deadline = seconds > 0 ? setTimeout(interrupt, seconds * 1000) : undefined;

  try {
    if (!signal.aborted) {
      for (const client of clients) {
        void client.start().catch(error => controller.abort(error));
      }

      await done.promise;
    }

    const reason: unknown = signal.reason;

    if (!(reason instanceof Error && reason.name === 'AbortError')) {
      throw reason;
    }
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', onAbort);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);

    for (const remove of unsubscribe) {
      remove();
    }

    await Promise.all(clients.map(client => client.dispose()));
  }
}
