import { expect, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';

import { createElectronClient } from './electron';
import { bytesField, pushFrame } from './testing/frames';

class DebuggerStub extends EventEmitter {
  private attached = false;
  readonly commands: string[] = [];

  attach(): void {
    this.attached = true;
  }

  detach(): void {
    this.attached = false;
    this.emit('detach', {}, 'target closed');
  }

  isAttached(): boolean {
    return this.attached;
  }

  async sendCommand(method: string): Promise<void> {
    this.commands.push(method);
  }

  notify(method: string, params: unknown): void {
    this.emit('message', {}, method, params, '');
  }
}

it('tracks only inbound frames and follows page reconnects', async () => {
  const debuggerSession = new DebuggerStub();
  const client = createElectronClient({ roomId: '42', webContents: { debugger: debuggerSession } });
  const event = mock();
  const error = mock();
  client.on('event', event);
  client.on('error', error);
  await client.start();
  expect(client.getStatus().status).toBe('connecting');

  const url = 'wss://webcast5-ws-web-lf.douyin.com/webcast/im/push/v2/';

  const frame = pushFrame(
    [{ method: 'WebcastChatMessage', payload: bytesField(3, '你好') }],
    'gzip',
  );

  const response = { opcode: 2, payloadData: frame.toString('base64') };
  debuggerSession.notify('Network.webSocketCreated', { requestId: 'chat', url });
  debuggerSession.notify('Network.webSocketFrameReceived', { requestId: 'unrelated', response });
  debuggerSession.notify('Network.webSocketFrameSent', { requestId: 'chat', response });
  expect(event).not.toHaveBeenCalled();

  debuggerSession.notify('Network.webSocketFrameReceived', { requestId: 'chat', response });
  expect(event).toHaveBeenCalledWith(expect.objectContaining({ content: '你好', roomId: '42' }));
  expect(client.getStatus().status).toBe('connected');
  debuggerSession.notify('Network.webSocketClosed', { requestId: 'chat' });
  expect(client.getStatus().status).toBe('connecting');

  debuggerSession.notify('Network.webSocketCreated', { requestId: 'next', url });
  debuggerSession.notify('Network.webSocketFrameReceived', { requestId: 'next', response });
  expect(event).toHaveBeenCalledTimes(2);
  expect(error).not.toHaveBeenCalled();

  await client.stop();
  expect(debuggerSession.listenerCount('message')).toBe(0);
  expect(debuggerSession.isAttached()).toBe(false);
});
