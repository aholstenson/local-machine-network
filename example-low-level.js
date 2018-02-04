'use strict';

const LowLevelNetwork = require('./low-level');

const net = new LowLevelNetwork({
	path: '../socket'
});

net.on('leader', socket => {
	console.log('This instance is the leader!');
});

net.on('connected', socket => {
	console.log('Connected to the leader');
});

net.on('connection', socket => {
	console.log('Incoming connection from someone else');
});


net.connect()
	.then(() => console.log('Connected!'))
	.catch(err => console.error(err));
