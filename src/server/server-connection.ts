import {Socket} from 'net';

import {PowerJet} from 'socket-jet';

import {LockManager, LockManagerLockOptions} from './lock-manager';

export class ServerConnection extends PowerJet {
  constructor(socket: Socket, private lockManager: LockManager) {
    super(socket);
  }

  async lock(
    resourceIds: string[],
    options: LockManagerLockOptions,
  ): Promise<string> {
    return this.lockManager.lock(resourceIds, options);
  }

  async 'extend-lock'(lockId: string, ttl: number | undefined): Promise<void> {
    return this.lockManager.extendLock(lockId, ttl);
  }

  async 'release-lock'(lockId: string): Promise<void> {
    return this.lockManager.releaseLock(lockId);
  }
}
