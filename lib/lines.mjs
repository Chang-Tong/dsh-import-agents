/**
 * Bounded-memory line reading for source transcripts.
 *
 * Session sources can exceed V8's maximum string length (2^29 - 24 ≈ 512 MB
 * characters): a codex rollout file of ~655 MB cannot be materialized with
 * `readFileSync(path, 'utf8')`, which throws "Cannot create a string longer
 * than 0x1fffffe8 characters". These helpers decode one file in bounded chunks
 * with a UTF-8 `StringDecoder` (so a multi-byte character split across a chunk
 * boundary is reassembled), and yield lines one at a time instead of building
 * one string and a full `split('\n')` array for the whole file.
 */

import { closeSync, openSync, readSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'

/** Decode chunk size: small enough that no per-chunk string approaches the limit. */
const CHUNK_BYTES = 8 << 20

/**
 * Iterate one file's lines without materializing the file as a single string.
 * @param file - path to read.
 * @param chunkBytes - decode buffer size in bytes.
 * @yields each line without its trailing newline; a trailing unterminated line is yielded.
 */
export function* fileLines(file, chunkBytes = CHUNK_BYTES) {
  const fd = openSync(file, 'r')
  try {
    const buffer = Buffer.allocUnsafe(chunkBytes)
    const decoder = new StringDecoder('utf8')
    let carry = ''
    for (;;) {
      const read = readSync(fd, buffer, 0, chunkBytes, null)
      if (read === 0) break
      const text = carry + decoder.write(buffer.subarray(0, read))
      let start = 0
      let index
      while ((index = text.indexOf('\n', start)) !== -1) {
        yield text.slice(start, index)
        start = index + 1
      }
      carry = text.slice(start)
    }
    carry += decoder.end()
    if (carry.length > 0) yield carry
  } finally {
    closeSync(fd)
  }
}

/**
 * Read one file's first line without reading the whole file.
 * @param file - path to read.
 * @returns the first line without its trailing newline, or '' for an empty file.
 */
export function readFirstLine(file) {
  for (const line of fileLines(file)) return line
  return ''
}
