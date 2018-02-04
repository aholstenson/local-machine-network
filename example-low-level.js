'use strict';

const LowLevelNetwork = require('./low-level');

const net = new LowLevelNetwork({
	path: '../socket'
});

net.on('leader', () => {
	console.log('This instance is the leader!');
});

net.on('connected', (socket, isSelf) => {
	console.log('Connected to the leader:', socket);
});

net.on('connection', socket => {
	console.log('Incoming connection from someone else:', socket);
});


net.connect()
	.then(() => console.log('Connected!'))
	.catch(err => console.error(err));
