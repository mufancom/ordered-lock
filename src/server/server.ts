import {EventEmitter} from 'events';
import {ListenOptions, Socket, createServer} from 'net';

import {LockManager} from './lock-manager';
import {ServerConnection} from './server-connection';

export interface ServerLogEntry {
  type: string;
  data: object;
}

export interface ServerOptions {
  listen: ListenOptions;
}

export class Server extends EventEmitter {
  private lockManager = new LockManager();

  constructor(options: ServerOptions) {
    super();

    this.lockManager.on('log', log => {
      this.emit('log', {
        type: `lock-manager:${log.type}`,
        data: log.data,
      });
    });

    let server = createServer(this.onConnection);

    server.listen(options.listen);

    server.on('error', error => this.emit('error', error));
  }

  private onConnection = (socket: Socket): void => {
    this.emit('log', {
      type: 'client-connected',
      data: {
        remote: socket.remoteAddress ?? '-',
      },
    });

    socket.on('close', () => {
      this.emit('log', {
        type: 'client-disconnected',
        data: {
          remote: socket.remoteAddress ?? '-',
        },
      });
    });

    let connection = new ServerConnection(socket, this.lockManager);

    connection.on('error', error => {
      this.emit('log', {
        type: 'connection-error',
        data: {
          remote: socket.remoteAddress,
          error: {
            name: error.name,
            message: error.message,
          },
        },
      });
    });
  };
}

export interface Server {
  /* eslint-disable @typescript-eslint/unified-signatures */

  on(event: 'log', listener: (entry: ServerLogEntry) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;

  emit(event: 'log', entry: ServerLogEntry): boolean;
  emit(event: 'error', error: Error): boolean;

  /* eslint-enable @typescript-eslint/unified-signatures */
}
