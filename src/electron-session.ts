type MessageListener = (event: unknown, method: string, params: unknown, sessionId: string) => void;
type DetachListener = (event: unknown, reason: string) => void;

interface Debugger {
  attach: () => void;
  detach: () => void;
  isAttached: () => boolean;
  sendCommand: (method: string) => Promise<unknown>;
  on: {
    (event: 'message', listener: MessageListener): unknown;
    (event: 'detach', listener: DetachListener): unknown;
  };
  removeListener: {
    (event: 'message', listener: MessageListener): unknown;
    (event: 'detach', listener: DetachListener): unknown;
  };
}

export interface ElectronWebContents {
  debugger: Debugger;
}

interface Observer {
  signal: AbortSignal;
  matchesUrl: (url: string) => boolean;
  onReady: () => void;
  onFrame: (base64: string) => void;
  onDisconnected: () => void;
}

export async function observeElectron(
  webContents: ElectronWebContents,
  options: Observer,
): Promise<void> {
  options.signal.throwIfAborted();
  const cdp = webContents.debugger;

  if (cdp.isAttached()) {
    throw new Error('The WebContents debugger is already attached');
  }

  const sockets = new Set<string>();
  const onMessage = watchSockets(sockets, options);
  const end = Promise.withResolvers<void>();
  const stop = () => end.resolve();
  let active = true;
  const onDetach: DetachListener = () => end.reject(new Error('Electron debugger detached'));

  cdp.attach();

  try {
    cdp.on('message', onMessage);
    cdp.on('detach', onDetach);
    options.signal.addEventListener('abort', stop, { once: true });

    if (options.signal.aborted) {
      return;
    }

    void cdp
      .sendCommand('Network.enable')
      .then(() => {
        if (active && !options.signal.aborted) {
          options.onReady();
        }
      })
      .catch(() => end.reject(new Error('Could not enable Electron network monitoring')));

    await end.promise;
  } finally {
    active = false;
    cdp.removeListener('message', onMessage);
    cdp.removeListener('detach', onDetach);
    options.signal.removeEventListener('abort', stop);

    if (cdp.isAttached()) {
      cdp.detach();
    }
  }
}

function watchSockets(sockets: Set<string>, options: Observer): MessageListener {
  return (_event, method, params, sessionId) => {
    if (sessionId || options.signal.aborted || !isRecord(params)) {
      return;
    }

    const { requestId } = params;

    if (typeof requestId !== 'string') {
      return;
    }

    switch (method) {
      case 'Network.webSocketCreated': {
        if (typeof params.url === 'string' && options.matchesUrl(params.url)) {
          sockets.add(requestId);
        }

        break;
      }

      case 'Network.webSocketClosed': {
        if (sockets.delete(requestId) && sockets.size === 0) {
          options.onDisconnected();
        }

        break;
      }

      case 'Network.webSocketFrameReceived': {
        receiveFrame(sockets, options, requestId, params.response);

        break;
      }
    }
  };
}

function receiveFrame(
  sockets: Set<string>,
  options: Observer,
  requestId: string,
  response: unknown,
): void {
  if (!sockets.has(requestId)) {
    return;
  }

  const frame = binaryPayload(response);

  if (frame !== undefined) {
    options.onFrame(frame);
  }
}

function binaryPayload(response: unknown): string | undefined {
  if (isRecord(response) && response.opcode === 2 && typeof response.payloadData === 'string') {
    return response.payloadData;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
