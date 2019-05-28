'use strict';

const { ObjectNetwork } = require('./dist/cjs/object');

const net = new ObjectNetwork({
	path: 'socket-test'
});

net.onLeader(socket => {
	console.log('This instance is the leader!');
});

net.onConnect(socket => {
	console.log('Connected to the leader');

	socket.send('Ping');
});

net.onConnection(socket => {
	console.log('Incoming connection from someone else');

	socket.send('Hello');
});

net.onMessage(msg => {
	console.log('Received a message from someone else');

	console.log(msg);
});

net.start()
	.then(() => console.log('Connected!'))
	.catch(err => console.error(err));
