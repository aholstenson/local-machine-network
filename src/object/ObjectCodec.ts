/**
 * Codec used to encode and decode objects sent over a `ObjectNetwork`.
 */
export interface ObjectCodec {
	/**
	 * Encode an object into a binary representation.
	 *
	 * @param object
	 */
	encode(object: any): Buffer;

	/**
	 * Decode a binary representation of an object.
	 *
	 * @param buffer
	 */
	decode(buffer: Buffer): any;
}
