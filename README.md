# local-machine-network

Provides a local machine network for simple inter-process communication (IPC).

## Installation

```
npm install local-machine-network
```

## Object based messaging

```javascript
const { ObjectNetwork } = require('local-machine-network');

const net = new LowLevelNetwork({
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

// Send a message to the leader - with any valid JSON
net.send({
  type: 'request',
});
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
