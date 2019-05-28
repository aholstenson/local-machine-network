import path from 'path';
import { unlink } from 'fs';
import { Socket, Server, connect, createServer } from 'net';

import { Event } from 'atvik';

import debug from 'debug';
import { lock } from 'proper-lockfile';

/**
 * Options for creating a new low level network.
 */
export interface LowLevelNetworkOptions {
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
 * Resolve the given path to a path that can be used with an IPC socket.
 */
function toSocketPath(p: string) {
	const resolved = path.resolve(p);
	if(process.platform === 'win32') {
		// On Windows IPC sockets need to be either in \\?\pipe\ or \\.\pipe\
		return path.join('\\\\?\\pipe', resolved);
	} else {
		// Other platforms are assumed to be Unix-like where sockets can be created anywhere
		return resolved;
	}
}

/**
 * Generate a random retry time between 30 and 130 ms.
 */
function randomRetryTime() {
	return Math.floor(30 + Math.random() * 100);
}

const client = Symbol('client');
const server = Symbol('server');
const releaseLock = Symbol('releaseLock');

const readyEvent = Symbol('readyEvent');
const errorEvent = Symbol('errorEvent');

const leaderEvent = Symbol('leaderEvent');
const connectEvent = Symbol('connectEvent');
const connectionEvent = Symbol('connectionEvent');

/**
 * Low-level network that provides sockets to and from a leader. When an
 * instance of this network is connected it can either become the leader, in
 * which case a server socket will be opened, or a client in which it will
 * connect to the leader.
 *
 * When connected the network will attempt to stay connected.
 */
export class LowLevelNetwork {
	private debug: debug.Debugger;

	private options: LowLevelNetworkOptions;
	public started: boolean;
	public leader: boolean;

	private [client]?: Socket;
	private [server]?: Server;
	private [releaseLock]?: () => Promise<void>;

	private [readyEvent]: Event<this>;
	private [errorEvent]: Event<this, [ Error ]>;

	private [connectEvent]: Event<this, [ Socket ]>;
	private [connectionEvent]: Event<this, [ Socket ]>;
	private [leaderEvent]: Event<this, [ Server ]>;

	constructor(options: LowLevelNetworkOptions) {
		if(typeof options !== 'object') {
			throw new Error('Options are needed to create a new network');
		}

		if(typeof options.path !== 'string') {
			throw new Error('Path for socket is required');
		}

		this.options = {
			path: options.path
		};

		this.debug = debug('local-machine-network:' + (options.id || ('[' + options.path + ']')));

		this.leader = false;
		this.started = false;

		this[readyEvent] = new Event(this);
		this[errorEvent] = new Event(this);

		this[connectEvent] = new Event(this);
		this[connectionEvent] = new Event(this);
		this[leaderEvent] = new Event(this);
	}

	get onConnect() {
		return this[connectEvent].subscribable;
	}

	get onConnection() {
		return this[connectionEvent].subscribable;
	}

	get onLeader() {
		return this[leaderEvent].subscribable;
	}

	get onReady() {
		return this[readyEvent].subscribable;
	}

	get onError() {
		return this[errorEvent].subscribable;
	}

	/**
	 * Start this network.
	 */
	public start(): Promise<void> {
		if(this.started) {
			// TODO: If we are started return promise that resolves if connected
		}

		this.started = true;
		return new Promise((resolve, reject) => {
			const readyHandle = this.onReady(() => {
				readyHandle.unsubscribe();
				errorHandle.unsubscribe();

				resolve();
			});

			const errorHandle = this.onError((err) => {
				readyHandle.unsubscribe();
				errorHandle.unsubscribe();

				reject();
			});

			// Attempt to connect or bind
			this.attemptConnectOrBind();
		});
	}

	/**
	 * Attempt to connect or become the master.
	 *
	 * The flow here is:
	 *
	 * 1) Attempt to acquire lock
	 * 2a) If lock acquired: Bind and become the master
	 * 2b): Otherwise: Connect to the master
	 */
	private attemptConnectOrBind(): void {
		// Resolve the paths to work with
		const socketPath = toSocketPath(this.options.path);

		// Reset leader flag
		this.leader = false;

		/*
		 * Attempt to get a lock, hopefully allowing us to create the
		 * socket and become the leader.
		 */
		lock(this.options.path, {
			/*
			 * As the socket doesn't exist before we lock we don't use realpath
			 * and instead let lock be created wherever.
			 */
			realpath: false,

			onCompromised: () => {
				const release = this[releaseLock];
				if(release) {
					this.debug('Lock on server path compromised, attempting release');

					release()
						.catch(err => this.debug('Unable to unlock, error: ', err))
						.then(() => {
							this[releaseLock] = undefined;
							this.reconnect('Attempting reconnect after compromised lock');
						});
				} else {
					this.reconnect('Lock on server path compromised');
				}
			}
		})
			.then((release) => {
				/**
				 * We now have the lock, try creating a server.
				 */

				// Store a reference to be able to release the lock
				this[releaseLock] = release;

				this.attemptBind(socketPath);
			})
			.catch(() => {
				/*
				 * Someone else is already holding the lock - try to
				 * connect to them.
				 */
				this.attemptConnect(socketPath);
			});
	}

	/**
	 * Unsafe: Release the lock if we have it. This is done if the server
	 * fails to bind or if the network is disconnected.
	 */
	private _releaseLock(): Promise<void> {
		const release = this[releaseLock];
		if(! release) return Promise.resolve();

		this[releaseLock] = undefined;
		return release();
	}

	private reconnect(message: string) {
		// Check that this network is started
		if(! this.started) return;

		// Resolve when to next retry a connection
		const retryTime = randomRetryTime();

		this.debug(message + '; Retrying in ' + retryTime + ' ms');

		setTimeout(() => this.attemptConnectOrBind(), retryTime);
	}

	private attemptConnect(socketPath: string): void {
		this.debug('Connecting as client');

		const socket = connect(socketPath, () => {
			this.debug('Connected to leader');

			this[client] = socket;
			this[connectEvent].emit(socket);

			// Indicate that the network is ready
			this[readyEvent].emit();
		});

		socket.on('error', err => {
			// Mark the client as non-existent
			const hadConnected = !! this[client];
			this[client] = undefined;

			// Resolve a readable debug message
			let message: string;
			const code = typeof (err as any).code !== 'undefined' ? (err as any).code : 'Unknown Error';
			if(hadConnected) {
				message = 'Disconnected from server with ' + code;
			} else {
				message = 'Could not connect to server, got code ' + code;
			}

			this.reconnect(message);
		});

		socket.on('close', hadError => {
			if(hadError) return;
			// Mark the client as non-existent
			const hadConnected = !! this[client];
			this[client] = undefined;

			// Request a reconnect
			this.reconnect('Disconnected from server without error');
		});
	}

	private attemptBind(socketPath: string, attempt=0): void {
		if(attempt > 10) {
			// Already tried to bind 10 times - just give up at this point
			this.debug('Could not bind server socket, giving up after 10 tries');

			this[errorEvent].emit(new Error('Could not bind server socket, giving up after 10 tries'));

			return;
		}

		this.debug('Creating socket as leader');

		// Try to unlink the socket path
		unlink(socketPath, unlinkErr => {
			if(unlinkErr && unlinkErr.code !== 'ENOENT') {
				const retryTime = randomRetryTime();

				this.debug('Could not unlink existing socket, errored with: ' + unlinkErr.code + '; Retrying in', retryTime, 'ms');

				setTimeout(
					() => this.attemptBind(socketPath, attempt + 1),
					retryTime
				);
				return;
			}

			const serverSocket = createServer();
			serverSocket.listen(socketPath, () => {
				// Server was successfully bound, store reference and resolve callback
				this.debug('Hosting network as leader');
				this[server] = serverSocket;

				// Mark as leader and emit event
				this.leader = true;
				this[leaderEvent].emit(serverSocket);

				// Indicate that the network is ready
				this[readyEvent].emit();
			});

			serverSocket.on('connection', socket => {
				this[connectionEvent].emit(socket);
			});

			serverSocket.on('error', err => {
				// Something went wrong, close this server and reconnect

				// Mark the server as non-existent
				const hadBound = !! this[server];
				this[server] = undefined;

				if(hadBound) {
					// Make sure the socket is closed
					serverSocket.close();

					this.reconnect('Server errored with ' + (err as any).code);
				} else {
					const retryTime = randomRetryTime();

					this.debug('Could not bind socket, errored with ' + (err as any).code + '; Retrying in', retryTime, 'ms');

					setTimeout(
						() => this.attemptBind(socketPath, attempt + 1),
						retryTime
					);
				}
			});
		});
	}

	public stop(): Promise<void> {
		this.started = false;

		const serverSocket = this[server];
		if(serverSocket) {
			return new Promise((resolve, reject) => {
				serverSocket.close(() => {
					// First unlink the socket path
					const socketPath = toSocketPath(this.options.path);
					unlink(socketPath, err => {
						this._releaseLock()
							.then(resolve)
							.catch(reject);
					});
				});
			});
		} else {
			const clientSocket = this[client];
			if(clientSocket) {
				return new Promise((resolve, reject) => {
					clientSocket.destroy();
					resolve();
				});
			} else {
				return Promise.resolve();
			}
		}
	}
}
