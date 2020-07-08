import {EventEmitter} from 'events';
import {NetConnectOpts, Socket, connect} from 'net';

import Debug from 'debug';
import * as v from 'villa';

import {ClientConnection} from './client-connection';

const debug = Debug('ordered-lock:client');

const CONNECT_OPTIONS_DEFAULT: NetConnectOpts = {
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

export interface ClientReconnectOptions {
  /** In seconds, defaults to 1. */
  initialInterval?: number;
  /** In seconds, defaults to 5. */
  maxInterval?: number;
  /** In seconds, defaults to 1.5. */
  intervalMultiplier?: number;
}

export interface ClientOptions {
  connect: NetConnectOpts;
  lock: ClientLockOptions;
  reconnect?: ClientReconnectOptions;
}

export class Client extends EventEmitter {
  private reconnectInterval = RECONNECT_INITIAL_INTERVAL_DEFAULT;

  private connectionPromise!: Promise<ClientConnection>;
  private connectionClosePromise!: Promise<void>;

  constructor(private options: ClientOptions) {
    super();

    this.connect(0);
  }

  async lock<T>(
    resourceIds: string | string[],
    handler: LockHandler<T>,
    options?: ClientLockOptions,
  ): Promise<T> {
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

    let lockId = await Promise.race([
      connection.call<string>('lock', resourceIds, options),
      this.connectionClosePromise,
    ]);

    if (!lockId) {
      throw new Error('Lock failure due to connection change');
    }

    debug('locked resources', resourceIds, lockId);

    try {
      // execute //

      return await handler(async ttl => {
        debug('extending lock', lockId);

        await connection.call('extend-lock', lockId, ttl);

        debug('extended lock', lockId);
      });
    } finally {
      // release //

      debug('releasing lock', lockId);

      await connection.call('release-lock', lockId).then(
        () => {
          debug('released lock', lockId);
        },
        error => {
          // It should be okay to ignore the error in most cases, as you can't do much at this phase.

          debug('release lock error', error);

          this.emit('log', {
            type: 'release-error',
            data: {
              error: {
                name: error.name,
                message: error.message,
              },
              resources: resourceIds,
              lock: lockId,
            },
          });
        },
      );
    }
  }

  private connect(interval: number): void {
    this.connectionPromise = v
      .sleep(interval * 1000)
      .then(() => this._connect())
      .then(([connection, socket]) => {
        this.connectionClosePromise = new Promise(resolve => {
          socket.on('close', () => {
            resolve();

            this.emit('disconnect');

            this.sleepAndReconnect();
          });
        });

        return connection;
      });
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
    return new Promise(resolve => {
      let socket = connect(
        {
          ...CONNECT_OPTIONS_DEFAULT,
          ...this.options.connect,
        },
        () => {
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
        },
      );
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
