import { Event } from 'atvik';
import debug from 'debug';

import { LowLevelNetwork } from './low-level';
import { Socket } from 'net';

import msgpack from 'msgpack-lite';

const connectEvent = Symbol('connectEvent');
const disconnectEvent = Symbol('disconnectEvent');

const leaderEvent = Symbol('leaderEvent');
const connectionEvent = Symbol('connectionEvent');

const messageEvent = Symbol('messageEvent');

/**
 * Options for creating an object network.
 */
export interface ObjectNetworkOptions {
	/**
	 * Optional id used for debug messages.
	 */
	id?: string;

	/**
	 * Path at which the network should create its socket.
	 */
	path: string;
}

/**
 * Interface for things that can send an object message.
 */
export interface ObjectSender {
	send(message: any): void;
}

/**
 * Message that can be received via the object network.
 */
export interface ObjectMessage {
	/**
	 * Return path of the message, can be used to send a message to whoever
	 * sent this message.
	 */
	returnPath: ObjectSender;

	/**
	 * Data carried by message.
	 */
	data: any;
}

/**
 * Adapter over a low-level network for those cases where clients want to
 * exchange objects with the leader. This implementation will use MessagePack
 * to encode and decode objects.
 */
export class ObjectNetwork {
	private debug: debug.Debugger;
	private lowLevel: LowLevelNetwork;

	private connection?: ObjectSocket;

	private [connectEvent]: Event<this, [ ObjectSocket ]>;
	private [connectionEvent]: Event<this, [ ObjectSocket ]>;
	private [leaderEvent]: Event<this, [ ]>;
	private [messageEvent]: Event<this, [ ObjectMessage ]>;

	/**
	 * Create a new object network.
	 */
	constructor(options: ObjectNetworkOptions) {

		this.debug = debug('local-machine-network:' + (options.id || ('[' + options.path + ']')));

		// Create the low-level network
		this.lowLevel = new LowLevelNetwork(options);

		this[connectEvent] = new Event(this);
		this[connectionEvent] = new Event(this);
		this[leaderEvent] = new Event(this);
		this[messageEvent] = new Event(this);

		/*
		 * When this instance becomes the leader make sure to intercept
		 * server socket errors and to emit the leader event.
		 */
		this.lowLevel.onLeader(serverSocket => {
			// Listen to all socket errors to avoid unexpected exits
			serverSocket.on('error', err => {
				this.debug('Caught error from server socket', err);
			});

			// If previously connected to a leader remove the reference
			this.connection = undefined;

			// Emit the leader event
			this[leaderEvent].emit();
		});

		/*
		 * On incoming connections make sure to wrap them with encoding and
		 * decoding.
		 */
		this.lowLevel.onConnection(clientSocket => {
			// Create the wrapped socket
			const connection = new ObjectSocket({
				socket: clientSocket,

				debug: this.debug,

				emitMessage: (msg) => this[messageEvent].emit(msg),

				send: this.send.bind(this)
			});

			this[connectionEvent].emit(connection);
		});

		/*
		 * When this instance is not the leader and it connects to something
		 * save a reference to the connection.
		 */
		this.lowLevel.onConnect(socket => {
			const connection = this.connection = new ObjectSocket({
				socket: socket,

				debug: this.debug,

				emitMessage: (msg) => this[messageEvent].emit(msg),

				send: this.send.bind(this)
			});

			this[connectEvent].emit(connection);
		});
	}

	get onConnect() {
		return this[connectEvent].subscribable;
	}

	get onLeader() {
		return this[leaderEvent].subscribable;
	}

	get onConnection() {
		return this[connectionEvent].subscribable;
	}

	get onMessage() {
		return this[messageEvent].subscribable;
	}

	/**
	 * Connect to the network.
	 */
	public start(): Promise<void> {
		return this.lowLevel.start();
	}

	/**
	 * Disconnect from the network.
	 */
	public stop() {
		return this.lowLevel.stop();
	}

	/**
	 * Send a message to the current leader.
	 */
	public send(message: any) {
		if(this.lowLevel.leader) {
			// This instance is the leader, emit the event locally
			this[messageEvent].emit({
				returnPath: this,
				data: message
			});
		} else if(this.connection) {
			// Connected to the leader send via the active socket
			this.connection.send(message);
		} else {
			this.debug('Unable to send message, not connected, message was:', message);
			throw new Error('Unable to send message, not connected');
		}
	}
}

interface ObjectSocketControl {
	send(message: any): void;

	emitMessage(message: ObjectMessage): void;

	debug: debug.Debugger;

	socket: Socket;
}

export class ObjectSocket {
	private control: ObjectSocketControl;

	private [disconnectEvent]: Event<this>;
	private [messageEvent]: Event<this, [ ObjectMessage ]>;

	constructor(control: ObjectSocketControl) {
		this.control = control;

		this[disconnectEvent] = new Event(this);
		this[messageEvent] = new Event(this);

		// Intercept errors and output them as debug info
		control.socket.on('error', err => {
			control.debug('Error received:', err);
		});

		// Emit disconnection events
		control.socket.on('close', () => this[disconnectEvent].emit());

		// Setup the decoder for incoming messages
		const decoder = msgpack.createDecodeStream();
		const pipe = control.socket.pipe(decoder);

		// When data is received emit an event
		decoder.on('data', data => {
			control.debug('Received message:', data);

			const message: ObjectMessage = {
				returnPath: this,
				data: data
			};

			control.emitMessage(message);
			this[messageEvent].emit(message);
		});

		// Catch errors on pipe and decoder
		decoder.on('error', err => control.debug('Error from decoder', err));
		pipe.on('error', err => control.debug('Error from pipe', err));
	}

	get onDisconnect() {
		return this[disconnectEvent].subscribable;
	}

	get onMessage() {
		return this[messageEvent].subscribable;
	}

	/**
	 * Send a message to this instance.
	 *
	 * @param {*} message
	 */
	public send(message: any) {
		const data = msgpack.encode(message);
		try {
			this.control.debug('Sending message to leader:', message);
			this.control.socket.write(data);
		} catch(err) {
			this.control.debug('Could not write, got an error:', err);
		}
	}
}
