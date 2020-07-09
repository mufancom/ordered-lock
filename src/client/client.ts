import {EventEmitter} from 'events';
import {Socket, TcpNetConnectOpts, connect} from 'net';

import Debug from 'debug';
import * as v from 'villa';

import {ClientConnection} from './client-connection';

const debug = Debug('ordered-lock:client');

const CONNECT_OPTIONS_DEFAULT: TcpNetConnectOpts = {
  port: 3292,
};

const RECONNECT_INITIAL_INTERVAL_DEFAULT = 1;
const RECONNECT_INTERVAL_MULTIPLIER_DEFAULT = 1.5;
const RECONNECT_MAX_INTERVAL_DEFAULT = 5;

export type LockHandler<T> = (
  extend: (ttl?: number) => Promise<void>,
) => Promise<T>;

export interface ClientLogEntry {
  type: string;
  data: object;
}

export interface ClientLockOptions {
  /**
   * Lock TTL, in seconds.
   */
  ttl: number;
  /**
   * Timeout of locking phase, in seconds.
   */
  lockingTimeout: number;
}

export interface ClientConnectOptions extends Partial<TcpNetConnectOpts> {}

export interface ClientReconnectOptions {
  /** In seconds, defaults to 1. */
  initialInterval?: number;
  /** In seconds, defaults to 5. */
  maxInterval?: number;
  /** In seconds, defaults to 1.5. */
  intervalMultiplier?: number;
}

export interface ClientOptions {
  lock: ClientLockOptions;
  connect?: ClientConnectOptions;
  reconnect?: ClientReconnectOptions;
}

export class Client extends EventEmitter {
  private reconnectInterval = RECONNECT_INITIAL_INTERVAL_DEFAULT;

  private connectionPromise!: Promise<ClientConnection>;

  constructor(private options: ClientOptions) {
    super();

    this.connect(0);
  }

  async lock(
    resourceIds: string | string[],
    options?: ClientLockOptions,
  ): Promise<string>;
  async lock<T>(
    resourceIds: string | string[],
    handler: LockHandler<T>,
    options?: ClientLockOptions,
  ): Promise<T>;
  async lock(
    resourceIds: string | string[],
    handler?: LockHandler<unknown> | ClientLockOptions,
    options?: ClientLockOptions,
  ): Promise<unknown> {
    if (typeof handler !== 'function') {
      options = handler;
      handler = undefined;
    }

    let {lock: lockOptions} = this.options;

    options = {
      ...lockOptions,
      ...options,
    };

    if (typeof resourceIds === 'string') {
      resourceIds = [resourceIds];
    }

    let connection = await this.connectionPromise;

    // lock //

    debug('locking resources', resourceIds);

    let lockId = await connection.call<string>('lock', resourceIds, options);

    debug('locked resources', resourceIds, lockId);

    if (!handler) {
      return lockId;
    }

    try {
      // execute //

      return await handler(async ttl => this.extendLock(lockId, ttl));
    } finally {
      // release //

      await this.releaseLock(lockId).catch(error => {
        // It should be okay to ignore the error in most cases, as you can't do much at this phase.
        debug('release lock error', error);
      });
    }
  }

  async extendLock(lockId: string, ttl?: number): Promise<void> {
    let connection = await this.connectionPromise;

    debug('extending lock', lockId);

    try {
      await connection.call<void>('extend-lock', lockId, ttl);
    } catch (error) {
      debug('extend lock error', error);

      this.emit('log', {
        type: 'extend-lock-error',
        data: {
          lock: lockId,
          error: {
            name: error.name,
            message: error.message,
          },
        },
      });

      throw error;
    }

    debug('extended lock', lockId);
  }

  async releaseLock(lockId: string): Promise<void> {
    let connection = await this.connectionPromise;

    debug('releasing lock', lockId);

    try {
      await connection.call<void>('release-lock', lockId);
    } catch (error) {
      debug('release lock error', error);

      this.emit('log', {
        type: 'release-lock-error',
        data: {
          lock: lockId,
          error: {
            name: error.name,
            message: error.message,
          },
        },
      });

      throw error;
    }

    debug('released lock', lockId);
  }

  private connect(delay: number): void {
    if (delay) {
      this.emit('log', {
        type: 'connect-delay',
        data: {
          delay,
        },
      });
    }

    this.connectionPromise = v
      .sleep(delay * 1000)
      .then(() => this._connect())
      .then(
        ([connection, socket]) => {
          socket.on('close', () => {
            this.emit('disconnect');

            this.emit('log', {
              type: 'disconnected',
              data: {},
            });

            this.sleepAndReconnect();
          });

          return connection;
        },
        () => {
          this.sleepAndReconnect();

          return this.connectionPromise;
        },
      );
  }

  private sleepAndReconnect(): void {
    let {
      reconnect: {
        maxInterval = RECONNECT_MAX_INTERVAL_DEFAULT,
        intervalMultiplier = RECONNECT_INTERVAL_MULTIPLIER_DEFAULT,
      } = {},
    } = this.options;

    let interval = this.reconnectInterval;

    this.reconnectInterval = Math.min(
      maxInterval,
      // Note `this.reconnectInterval` might be 0 as `reconnectInitialInterval`
      // might be 0. So fallback to `RECONNECT_INITIAL_INTERVAL_DEFAULT` before
      // multiply.
      (this.reconnectInterval || RECONNECT_INITIAL_INTERVAL_DEFAULT) *
        intervalMultiplier,
    );

    this.connect(interval);
  }

  private _connect(): Promise<[ClientConnection, Socket]> {
    return new Promise((resolve, reject) => {
      let onErrorBeforeConnect = (error: Error): void => {
        debug('connect error', error);

        this.emit('log', {
          type: 'connect-error',
          data: {
            error: {
              name: error.name,
              message: error.message,
            },
          },
        });

        reject();
      };

      let socket = connect(
        {
          ...CONNECT_OPTIONS_DEFAULT,
          ...this.options.connect,
        },
        () => {
          socket.off('error', onErrorBeforeConnect);

          let connection = new ClientConnection(socket);

          // Capture the error but for debugging only, it will trigger `close`
          // anyway.
          connection.on('error', error => {
            debug('connection error', error);

            this.emit('log', {
              type: 'connection-error',
              data: {
                error: {
                  name: error.name,
                  message: error.message,
                },
              },
            });
          });

          resolve([connection, socket]);

          this.emit('connect');

          this.emit('log', {
            type: 'connected',
            data: {},
          });
        },
      );

      socket.on('error', onErrorBeforeConnect);
    });
  }
}

export interface Client {
  /* eslint-disable @typescript-eslint/unified-signatures */

  on(event: 'connect', listener: () => void): this;
  on(event: 'disconnect', listener: () => void): this;
  on(event: 'log', listener: (entry: ClientLogEntry) => void): this;

  emit(event: 'connect'): boolean;
  emit(event: 'disconnect'): boolean;
  emit(event: 'log', entry: ClientLogEntry): boolean;

  /* eslint-enable @typescript-eslint/unified-signatures */
}
