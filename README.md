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
const { ObjectNetwork, JSONCodec } = require('local-machine-network');

const net = new ObjectNetwork({
  path: 'path-to-socket',

  codec: JSONCodec
});

net.onLeader(() => {
  console.log('This instance is the leader!');
});

net.onConnection(other => {
  console.log('Incoming connection from someone else:', other);
});

net.onMessage({ returnPath, data } => {
  console.log('Got a message:', data);

  if(data.type === 'request') {
    // If type is request send something back
    returnPath.send({
      type: 'response',
    });
  }
});

// Start the network
net.start()
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

net.onLeader(serverSocket => {
  console.log('This instance is the leader!');
});

net.onConnect(socket => {
  console.log('Connected to the leader:', socket);
});

net.onConnection(socket => {
  console.log('Incoming connection from someone else:', socket);
});

// Start the network
net.start()
  .then(...)
  .catch(handleConnectionError);
```
