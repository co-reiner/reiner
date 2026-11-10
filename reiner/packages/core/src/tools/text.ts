/**
 * @file Reading a file's bytes as text, or telling that it is binary.
 * @see {@link ../../../../docs/architecture/file-exchange.md#tools | File exchange: tools}
 */

/** Decode a file as text (UTF-8, UTF-16 or Windows-1252); undefined for binary. */
export function decodeText(data: Uint8Array): { text: string; encoding: string } | undefined {
  if (data.length === 0) return { text: '', encoding: 'utf-8' };
  const littleEndian = data[0] === 0xff && data[1] === 0xfe;
  const bigEndian = data[0] === 0xfe && data[1] === 0xff;
  if (littleEndian || bigEndian) {
    try {
      // The byte order mark says which way round the pairs are.
      const decoder = new TextDecoder(bigEndian ? 'utf-16be' : 'utf-16le', { fatal: true });
      return { text: decoder.decode(data), encoding: 'utf-16' };
    } catch {
      return undefined;
    }
  }
  if (data.subarray(0, 8192).includes(0)) return undefined;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(data);
    const bom = data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf;
    return { text, encoding: bom ? 'utf-8-sig' : 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(data), encoding: 'windows-1252' };
  }
}
