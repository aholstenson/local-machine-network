# local-machine-network

[![npm version](https://badge.fury.io/js/local-machine-network.svg)](https://badge.fury.io/js/local-machine-network)
[![Dependencies](https://david-dm.org/aholstenson/local-machine-network.svg)](https://david-dm.org/aholstenson/local-machine-network)

Provides a local machine network for simple inter-process communication (IPC).
Comes in two variants, one for exchanging objects between the leader and client
and one for getting the raw sockets.

## Installation

```
npm install local-machine-network
```

## Object based messaging

```javascript
const { ObjectNetwork } = require('local-machine-network');

const net = new ObjectNetwork({
  path: 'path-to-socket'
});

net.on('leader', () => {
  console.log('This instance is the leader!');
});

net.on('connection', other => {
  console.log('Incoming connection from someone else:', other);
});

net.on('message', { returnPath, data } => {
  console.log('Got a message:', data);

  if(data.type === 'request') {
    // If type is request send something back
    returnPath.send({
      type: 'response',
    });
  }
});

// Connect to the network
net.connect()
  .then(() => {
    // Send a message to the leader - with any valid JSON
    net.send({
      type: 'request',
    });
  })
  .catch(handleConnectionError);
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

// Connect to the network
net.connect()
  .then(...)
  .catch(handleConnectionError);
```
