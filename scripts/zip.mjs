/**
 * A SMALL ZIP WRITER AND READER, WITH NO DEPENDENCIES.
 *
 * The downloads have to come out byte for byte the same from the same inputs, so their
 * SHA-256 can be printed on the site and checked. Everything that usually varies is fixed:
 *
 *   · entries are sorted by name, and a name may appear once;
 *   · every entry is dated 1980-01-01 00:00 (the zip format's zero), with mode 0644, no
 *     extra fields and no comments;
 *   · text (js, html, css, json, txt, md) is deflated at level 9 by node:zlib; pictures,
 *     which are compressed already, are stored.
 *
 * Only what the site ships is supported: no directories as entries (unzip makes them from the
 * paths), no zip64 (every file is far below 4 GB), ASCII names only.
 *
 * readZip() is the other half: it parses the central directory, inflates, and checks every
 * CRC-32. The tests and the verify script read the zips with it; the tests also have the
 * system's `unzip` test them, when it is there, so the format is checked by a second reader.
 */
import zlib from "node:zlib";

const DOS_TIME = 0;                              // 00:00:00
const DOS_DATE = (0 << 9) | (1 << 5) | 1;        // 1980-01-01
const STORE = 0, DEFLATE = 8;
const MADE_BY = (3 << 8) | 20;                   // Unix, zip spec 2.0: the external attributes are a Unix mode
const FILE_MODE = 0o100644;
const DEFLATED_TYPES = /\.(m?js|html|css|json|txt|md|svg|map)$/i;

/** A path inside a zip: forward slashes, no leading slash, no "." or ".." part, printable ASCII. */
export function safeEntryName(name) {
  return typeof name === "string" && name.length > 0 && name.length < 512
    && /^[\x21-\x7e]+(?: [\x21-\x7e]+)*$/.test(name) && !name.startsWith("/") && !name.includes("\\")
    && name.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/**
 * Build a zip from [{ name, data }] (data: Buffer or string). Returns a Buffer.
 * The same entries always give the same bytes.
 */
export function writeZip(entries) {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const seen = new Set();
  const locals = [], centrals = [];
  let offset = 0;
  for (const entry of sorted) {
    if (!safeEntryName(entry.name)) throw new Error(`zip: unsafe entry name ${JSON.stringify(entry.name)}`);
    if (seen.has(entry.name)) throw new Error(`zip: ${entry.name} twice`);
    seen.add(entry.name);
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), "utf8");
    const crc = zlib.crc32(data) >>> 0;
    let method = STORE, body = data;
    if (DEFLATED_TYPES.test(entry.name) && data.length > 0) {
      const deflated = zlib.deflateRawSync(data, { level: 9, memLevel: 9, strategy: zlib.constants.Z_DEFAULT_STRATEGY });
      if (deflated.length < data.length) { method = DEFLATE; body = deflated; }
    }
    const name = Buffer.from(entry.name, "ascii");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);                  // version needed: 2.0
    local.writeUInt16LE(0, 6);                   // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);                  // no extra field
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(MADE_BY, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);                // extra
    central.writeUInt16LE(0, 32);                // comment
    central.writeUInt16LE(0, 34);                // disk
    central.writeUInt16LE(0, 36);                // internal attributes
    central.writeUInt32LE((FILE_MODE << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  if (sorted.length > 0xffff || offset > 0xffffffff) throw new Error("zip: too large for a zip without zip64");
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, end]);
}

/**
 * Read a zip written by writeZip (or any plain zip: stored or deflated, no zip64, no
 * encryption). Returns [{ name, data, method, crc, date, time, mode }] in the central
 * directory's order. Throws on anything it does not understand, and on a bad CRC.
 */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip: no end of central directory");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`zip: bad central directory entry ${n}`);
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const time = buf.readUInt16LE(p + 12), date = buf.readUInt16LE(p + 14), crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const mode = buf.readUInt32LE(p + 38) >>> 16, localAt = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (flags & 0x1) throw new Error(`zip: ${name} is encrypted`);
    if (buf.readUInt32LE(localAt) !== 0x04034b50) throw new Error(`zip: bad local header for ${name}`);
    const start = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    const body = buf.subarray(start, start + csize);
    const data = method === STORE ? Buffer.from(body) : method === DEFLATE ? zlib.inflateRawSync(body) : null;
    if (!data) throw new Error(`zip: ${name} uses method ${method}`);
    if (data.length !== usize) throw new Error(`zip: ${name} is ${data.length} bytes, the directory says ${usize}`);
    if ((zlib.crc32(data) >>> 0) !== crc) throw new Error(`zip: ${name} fails its CRC-32`);
    out.push({ name, data, method, crc, date, time, mode });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
