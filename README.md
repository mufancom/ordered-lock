[![NPM Package](https://badge.fury.io/js/ordered-lock.svg)](https://www.npmjs.com/package/ordered-lock)
[![Build Status](https://travis-ci.org/makeflow/ordered-lock.svg?branch=master)](https://travis-ci.org/makeflow/ordered-lock)

# Ordered Lock

Minimalist single thread ordered lock for distributed clients.

## Installation

### All-in-One

```
yarn add ordered-lock
```

```ts
import {Client} from 'ordered-lock';

let client = new Client({
  connect: {
    host: 'ordered-lock',
    port: 3292,
  },
  lock: {
    ttl: 2,
    lockingTimeout: 10,
  },
});

client.lock('123', async extend => {
  // ...

  extend(2);
});

client.lock(['123', '456'], async extend => {
  // ...
});
```

You probably don't need to use the server library, check out the Docker image.

```ts
import {Server} from 'ordered-lock/server';

// ...
```

### Docker

```
docker pull makeflow/ordered-lock
```

It listens on port `3292`.

## License

MIT License.
