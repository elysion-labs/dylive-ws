import { LiveClient } from './client';
import type { ClientLifecycleOptions } from './client';
import { observeElectron } from './electron-session';
import type { ElectronWebContents } from './electron-session';
import { decodeCdpPayload } from './protocol';

export type { ElectronWebContents } from './electron-session';

export interface ElectronClientOptions extends ClientLifecycleOptions {
  webContents: ElectronWebContents;
  matchesUrl?: (url: string) => boolean;
}

export function createElectronClient(options: ElectronClientOptions): LiveClient {
  const { webContents, matchesUrl = isDouyinLiveSocket, ...lifecycle } = options;

  return new LiveClient({ reconnect: false, ...lifecycle }, session =>
    observeElectron(webContents, {
      signal: session.signal,
      matchesUrl,
      onReady: session.onReady,
      onDisconnected: session.onDisconnected,
      onFrame: payload => {
        try {
          const messages = decodeCdpPayload(payload);

          if (messages.length) {
            session.onConnected();
          }

          session.onMessages(messages);
        } catch (error) {
          session.onError(
            error instanceof Error ? error : new Error('Could not decode the Douyin frame'),
          );
        }
      },
    }),
  );
}

function isDouyinLiveSocket(input: string): boolean {
  const url = URL.parse(input);

  return (
    url?.protocol === 'wss:' &&
    url.hostname.endsWith('.douyin.com') &&
    /^\/webcast\/im\/push(?:\/|$)/.test(url.pathname)
  );
}
