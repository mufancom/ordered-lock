#!/usr/bin/env node

import {Server} from '../server';

const PORT_DEFAULT = 3292;

const server = new Server({
  listen: {
    port: Number(process.env.PORT) || PORT_DEFAULT,
  },
});

server.on('log', log => {
  console.info(log.type, JSON.stringify(log.data));
});

server.on('error', error => {
  console.error(error);
  process.exit(1);
});
