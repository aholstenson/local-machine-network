# local-machine-network

Provides a local machine network for simple inter-process communication (IPC).

## Installation

```
npm install local-machine-network
```

## Low-level networks

```javascript
const { LowLevelNetwork } = require('local-machine-network');

const net = new LowLevelNetwork({
  path: 'path-to-socket'
});

net.on('leader', serverSocket => {
  console.log('This instance is the leader!');

  // Low-level networks requires the consumer to handle errors
  serverSocket.on('error', handleErrorProperly);
});

net.on('connected', socket => {
  console.log('Connected to the leader:', socket);

  // Low-level networks requires the consumer to handle errors
  socket.on('error', handleErrorProperly);
});

net.on('connection', socket => {
  console.log('Incoming connection from someone else:', socket);

  // Low-level networks requires the consumer to handle errors
  socket.on('error', handleErrorProperly);
});
```
