import { Event } from 'atvik';
import debug from 'debug';

import { LowLevelNetwork } from '../LowLevelNetwork';
import { Socket } from 'net';
import { ObjectCodec } from './ObjectCodec';
import { PacketDecodingStream, encodePacket } from './packets';

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

	/**
	 * The codec that is used for messages.
	 */
	codec: ObjectCodec;
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

	private readonly codec: ObjectCodec;

	private [connectEvent]: Event<this, [ ObjectSocket ]>;
	private [connectionEvent]: Event<this, [ ObjectSocket ]>;
	private [leaderEvent]: Event<this, [ ]>;
	private [messageEvent]: Event<this, [ ObjectMessage ]>;

	/**
	 * Create a new object network.
	 */
	constructor(options: ObjectNetworkOptions) {
		if(! options) {
			throw new Error('options are required');
		}

		if(! options.path) {
			throw new Error('path needs to be specified');
		}

		if(! options.codec) {
			throw new Error('codec needs to be specified');
		}

		this.debug = debug('local-machine-network:' + (options.id || ('[' + options.path + ']')));

		// Create the low-level network
		this.lowLevel = new LowLevelNetwork(options);

		this.codec = options.codec;

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

				send: this.send.bind(this),

				codec: this.codec
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

				send: this.send.bind(this),

				codec: this.codec
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

	codec: ObjectCodec;
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
		const decoder = new PacketDecodingStream();
		const pipe = control.socket.pipe(decoder);

		// When data is received emit an event
		decoder.on('data', data => {
			const msg = control.codec.decode(data);
			control.debug('Received message:', msg);

			const message: ObjectMessage = {
				returnPath: this,
				data: msg
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
		const data = this.control.codec.encode(message);
		const packet = encodePacket(data);
		try {
			this.control.debug('Sending message to leader:', message);
			this.control.socket.write(packet);
		} catch(err) {
			this.control.debug('Could not write, got an error:', err);
		}
	}
}
