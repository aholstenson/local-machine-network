'use strict';

const { LowLevelNetwork } = require('./');

const net = new LowLevelNetwork({
	path: 'socket-test'
});

net.onLeader(socket => {
	console.log('This instance is the leader!');
});

net.onConnect(socket => {
	console.log('Connected to the leader');
});

net.onConnection(socket => {
	console.log('Incoming connection from someone else');
});

net.start()
	.then(() => console.log('Connected!'))
	.catch(err => console.error(err));
