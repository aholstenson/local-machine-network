import { ObjectCodec } from './ObjectCodec';

/**
 * Codec that encodes and decodes objects as JSON.
 */
export const JSONCodec: ObjectCodec = {
	encode(obj: any): Buffer {
		return Buffer.from(JSON.stringify(obj), 'utf-8');
	},

	decode(buffer: Buffer): any {
		return JSON.parse(buffer.toString('utf-8'));
	}
};
