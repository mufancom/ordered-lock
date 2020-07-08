import 'villa/platform/node';

import * as v from 'villa';

import {Client} from '../client';
import {Server} from '../server';

const PORT = 3292;

new Server({
  listen: {
    port: PORT,
  },
});

const client1 = new Client({
  connect: {
    port: PORT,
  },
  lock: {
    ttl: 30,
    lockingTimeout: 10,
  },
});

const client2 = new Client({
  connect: {
    port: PORT,
  },
  lock: {
    ttl: 30,
    lockingTimeout: 10,
  },
});

test('clients should connect', async () => {
  await [v.awaitable(client1, 'connect'), v.awaitable(client2, 'connect')];
});

test('should lock and release', async () => {
  let result = await client1.lock('abc', async () => {
    await v.sleep(10);
    return 123;
  });

  expect(result).toBe(123);
});

test('should queue handlers locking the same resource', async () => {
  let count = 0;

  await Promise.all([
    expect(
      client1.lock('abc', async () => {
        count++;
        await v.sleep(200);
        return count;
      }),
    ).resolves.toBe(1),
    expect(
      v.sleep(100).then(() =>
        client2.lock('abc', async () => {
          count++;
          return count;
        }),
      ),
    ).resolves.toBe(2),
  ]);
});

test('should queue handlers locking the multiple resources', async () => {
  let count = 0;

  await Promise.all([
    expect(
      client1.lock(['abc', 'def', 'ghi'], async () => {
        count++;
        await v.sleep(200);
        return count;
      }),
    ).resolves.toBe(1),
    expect(
      v.sleep(100).then(() =>
        client2.lock(['abc', 'def', 'jkl'], async () => {
          count++;
          return count;
        }),
      ),
    ).resolves.toBe(2),
  ]);
});
