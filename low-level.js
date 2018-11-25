'use strict';

const path = require('path');
const fs = require('fs');
const net = require('net');
const EventEmitter = require('events');

const eos = require('end-of-stream');

const debug = require('debug')('local-machine-network');
const pidlockfile = require('pidlockfile');

/**
 * Resolve the given path to a path that can be used with an IPC socket.
 */
function toSocketPath(p) {
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
 * Resolve a lock path, combines the path of the socket with the extension
 * `.lock`.
 */
function toLockPath(p) {
	return path.resolve(p + '.lock');
}

/**
 * Generate a random retry time between 30 and 130 ms.
 */
function randomRetryTime() {
	return Math.floor(30 + Math.random() * 100);
}

/**
 * Low-level network that provides sockets to and from the leader.
 */
module.exports = class LowLevelNetwork extends EventEmitter {

	constructor(options={}) {
		super();

		if(typeof options.path !== 'string') {
			throw new Error('path for socket is required');
		}

		this.options = {
			path: options.path
		};

		this.started = false;
	}

	connect() {
		if(this.started) {
			// TODO: If we are started return promise that resolves if connected
		}

		this.started = true;
		return new Promise((resolve, reject) => {
			this.attemptConnectOrBind(err => {
				if(err) {
					debug('Unexpected error during initial connect:', err);
					reject(err);
				} else {
					resolve();
				}
			});
		});
	}

	attemptConnectOrBind(callback) {
		// Check that this network is started
		if(! this.started) return;

		// Resolve the paths to work with
		const socketPath = toSocketPath(this.options.path);
		const lockPath = toLockPath(this.options.path);

		// Reset leader flag
		this.leader = false;

		/*
		 * Attempt to get a lock, hopefully allowing us to create the
		 * socket and become the leader.
		 */
		pidlockfile.lock(lockPath, err => {
			if(err) {
				/*
				 * Someone else is already holding the lock - try to
				 * connect to them.
				 */
				this.attemptConnect(socketPath, callback);
			} else {
				/**
				 * We now have the lock, try creating a server.
				 */
				this.attemptBind(socketPath, callback);
			}
		});
	}

	attemptConnect(socketPath, callback) {
		debug('Connecting as client');

		const client = net.connect(socketPath, err => {
			if(err) {
				const retryTime = randomRetryTime();
				debug('Could not connect to server:', err.code, '- retrying in', retryTime, 'ms');

				setTimeout(() => this.attemptConnectOrBind(callback), retryTime);
			} else {
				debug('Connected to leader');

				this.client = client;
				this.emit('connected', client);

				callback();
			}
		});

		eos(client, err => {
			const retryTime = randomRetryTime();
			if(err) {
				debug('Disconnected from server with', err.code, '- retrying in', retryTime, 'ms');
			} else {
				debug('Disconnected from server without error, retrying in', retryTime, 'ms');
			}

			setTimeout(() => this.attemptConnectOrBind(callback), retryTime);
		});
	}

	attemptBind(socketPath, callback) {
		debug('Creating socket as leader');

		// Try to unlink the socket path
		fs.unlink(socketPath, err => {
			if(err && err.code !== 'ENOENT') {
				callback(new Error('Could not unlink existing socket:', err.code));
				return;
			}

			const server = net.createServer();
			server.listen(socketPath, err => {
				if(err) {
					// When an error occurs we retry binding in a bit
					const retryTime = randomRetryTime();
					debug('Could not bind, retrying in', retryTime, 'ms. Error was:', err);

					setTimeout(
						() => this.attemptBind(socketPath, callback),
						retryTime
					);
				} else {
					// Server was succesfully bound, store reference and resolve callback
					debug('Hosting network as leader');
					this.server = server;

					// Mark as leader and emit event
					this.leader = true;
					this.emit('leader', server);

					// Resolve the callback
					callback();
				}
			});

			server.on('connection', socket => {
				this.emit('connection', socket);
			});

			server.on('error', err => {
				// Something went wrong, close this server and reconnect
				const retryTime = randomRetryTime();
				debug('Error ocurred, retrying connection in', retryTime, 'ms. Error was:', err);

				setTimeout(() => this.attemptConnectOrBind(callback), retryTime);
				server.close();
			});
		});
	}

	disconnect() {
		this.started = false;

		if(this.server) {
			return new Promise((resolve, reject) => {
				this.server.close(err => {
					// First unlink the socket path
					const socketPath = toSocketPath(this.options.path);
					fs.unlink(socketPath, err => {

						// Release the lock
						const lock = toLockPath(this.options.path);
						pidlockfile.unlock(lock, e => {
							if(err) {
								reject(err);
							} else if(e) {
								reject(e);
							} else {
								resolve();
							}
						});
					});
				});
			});
		} else {
			return new Promise((resolve, reject) => {
				this.client.destroy(err => {
					this.client = null;
					if(err) {
						reject(err);
					} else {
						resolve();
					}
				});
			});
		}
	}
};
