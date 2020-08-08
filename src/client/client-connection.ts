import {Socket} from 'net';

import {PowerJet} from 'socket-jet';

export class ClientConnection extends PowerJet {
  constructor(socket: Socket) {
    super(socket);

    socket.setKeepAlive(true);
  }
}
