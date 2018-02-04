'use strict';

const EventEmitter = require('events');
const LowLevelNetwork = require('./low-level');
const msgpack = require('msgpack-lite');

const debug = require('debug');

/**
 * Adapter over a low-level network for those cases where clients want to
 * exchange objects with the leader. This implementation will use MessagePack
 * to encode and decode objects.
 */
module.exports = class ObjectNetwork extends EventEmitter {

	/**
	 * Create a new object network.
	 */
	constructor(options) {
		super();

		// Setup a debug utility
		this.debug = debug('local-machine-network:' + (options.id || ('[' + options.path + ']')));

		// Create the low-level network
		this.lowLevel = new LowLevelNetwork(options);

		/*
		 * When this instance becomes the leader make sure to intercept
		 * server socket errors and to emit the leader event.
		 */
		this.lowLevel.on('leader', serverSocket => {
			// Listen to all socket errors to avoid unexpected exits
			serverSocket.on('error', err => {
				this.debug('Caught error from server socket', err);
			});

			// If previously connected to a leader remove the reference
			this.connection = null;

			// Emit the leader event
			this.emit('leader');
		});

		/*
		 * On incoming connections make sure to wrap them with encoding and
		 * decoding.
		 */
		this.lowLevel.on('connection', clientSocket => {
			// Create the wrapped socket
			const connection = new WrappedSocket(this, clientSocket);
			this.emit('connection', connection);
		});

		/*
		 * When this instance is not the leader and it connects to something
		 * save a reference to the connection.
		 */
		this.lowLevel.on('connected', socket => {
			this.connection = new WrappedSocket(this, socket);
		});
	}

	/**
	 * Connect to the network.
	 */
	connect() {
		return this.lowLevel.connect()
			.then(() => this);
	}

	/**
	 * Disconnect from the network.
	 */
	disconnect() {
		return this.lowLevel.disconnect();
	}

	/**
	 * Send a message to the current leader.
	 */
	send(message) {
		if(this.lowLevel.leader) {
			// This instance is the leader, emit the event locally
			this.emit('message', {
				returnPath: this,
				data: message
			});
		} else {
			// Connected to the leader send via the active socket
			this.connection.send(message);
		}
	}
};

class WrappedSocket extends EventEmitter {

	constructor(parent, socket) {
		super();

		this.parent = parent;
		this.socket = socket;

		// Intercept errors and output them as debug info
		socket.on('error', err => {
			parent.debug('Error received:', err);
		});

		// Emit disconnection events
		socket.on('close', () => this.emit('disconnected'));

		// Setup the decoder for incoming messages
		const decoder = msgpack.createDecodeStream();
		const pipe = socket.pipe(decoder);

		// When data is received emit an event
		decoder.on('data', data => {
			parent.debug('Received message:', data);

			const message = {
				returnPath: this,
				data: data
			};

			parent.emit('message', message);
			this.emit('message', message);
		});

		// Catch errors on pipe and decoder
		decoder.on('error', err => parent.debug('Error from decoder', err));
		pipe.on('error', err => parent.debug('Error from pipe', err));
	}

	/**
	 * Send a message to this instance.
	 *
	 * @param {*} message
	 */
	send(message) {
		const data = msgpack.encode(message);
		try {
			this.parent.debug('Sending message to leader:', message);
			this.socket.write(data);
		} catch(err) {
			this.parent.debug('Could not write, got an error:', err);
		}
	}
}
