import {EventEmitter} from 'events';

import {v1 as uuid} from 'uuid';

interface LockEntry {
  release(): void;
  extend(ttl?: number): void;
}

export interface LockManagerLogEntry {
  type: string;
  data: object;
}

export interface LockManagerLockOptions {
  ttl: number;
  lockingTimeout: number;
}

export class LockManager extends EventEmitter {
  private resourceIdToLockPromiseMap = new Map<string, Promise<void>>();

  private lockEntryMap = new Map<string, LockEntry>();

  async lock(
    resourceIds: string[],
    {lockingTimeout, ttl}: LockManagerLockOptions,
  ): Promise<string> {
    let that = this;

    let lockId = uuid();

    that.emit('log', {
      type: 'locking',
      data: {
        lock: lockId,
        resources: resourceIds,
      },
    });

    let resourceIdToLockPromiseMap = this.resourceIdToLockPromiseMap;
    let lockEntryMap = this.lockEntryMap;

    let resolveNextLockPromise!: () => void;

    // This will be resolved once the lock gets released or error.
    let nextLockPromise = new Promise<void>(resolve => {
      resolveNextLockPromise = resolve;
    });

    let lockPromiseSet = new Set<Promise<void>>();

    for (let resourceId of resourceIds) {
      let lockPromise = resourceIdToLockPromiseMap.get(resourceId);

      if (lockPromise) {
        lockPromiseSet.add(lockPromise);
      }

      // Replace the current resource lock promises to the new one.
      resourceIdToLockPromiseMap.set(resourceId, nextLockPromise);
    }

    try {
      await Promise.race([
        Promise.all(Array.from(lockPromiseSet)),
        // If timed out during locking, this will result in an error thrown and
        // no lock ID will be returned.
        new Promise((_resolve, reject) =>
          setTimeout(
            () => reject(new Error('Timed out locking resources')),
            lockingTimeout * 1000,
          ),
        ),
      ]);
    } catch (error) {
      resolveNextLockPromise();

      that.emit('log', {
        type: 'locking-timed-out',
        data: {
          lock: lockId,
        },
      });

      throw error;
    }

    that.emit('log', {
      type: 'locked',
      data: {
        lock: lockId,
      },
    });

    let timeoutId: NodeJS.Timeout | undefined;

    lockEntryMap.set(lockId, {
      release() {
        clearTimeout(timeoutId!);

        release();
      },
      extend(newTTL = ttl) {
        extend(newTTL);

        that.emit('log', {
          type: 'lock-extended',
          data: {
            lock: lockId,
          },
        });
      },
    });

    extend(ttl);

    function extend(newTTL: number): void {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
        that.emit('log', {
          type: 'lock-timed-out',
          data: {
            lock: lockId,
          },
        });

        release();
      }, newTTL * 1000);
    }

    function release(): void {
      lockEntryMap.delete(lockId);

      for (let resourceId of resourceIds) {
        if (resourceIdToLockPromiseMap.get(resourceId) === nextLockPromise) {
          // If the currently stored promise is exactly this `nextLockPromise`,
          // it means no other lock locks this resource after this. So delete
          // to free the key value.
          resourceIdToLockPromiseMap.delete(resourceId);
        }
      }

      resolveNextLockPromise();

      that.emit('log', {
        type: 'lock-released',
        data: {
          lock: lockId,
        },
      });
    }

    return lockId;
  }

  extendLock(lockId: string, ttl: number | undefined): void {
    this.requireLockEntry(lockId).extend(ttl);
  }

  releaseLock(lockId: string): void {
    this.requireLockEntry(lockId).release();
  }

  private requireLockEntry(lockId: string): LockEntry {
    let lockEntry = this.lockEntryMap.get(lockId);

    if (!lockEntry) {
      throw new Error('Lock not found');
    }

    return lockEntry;
  }
}

export interface LockManager {
  /* eslint-disable @typescript-eslint/unified-signatures */

  on(event: 'log', listener: (entry: LockManagerLogEntry) => void): this;

  emit(event: 'log', entry: LockManagerLogEntry): boolean;

  /* eslint-enable @typescript-eslint/unified-signatures */
}
