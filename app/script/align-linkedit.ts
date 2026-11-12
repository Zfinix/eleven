// Xcode 27's linker can leave the string table 4-byte aligned; dyld then refuses the library
// ("mis-aligned LINKEDIT string pool"). Pads it to 8. Run on an unsigned Mach-O, then sign it.
const path = process.argv[2];
if (!path) throw new Error("usage: bun script/align-linkedit.ts <unsigned .node>");

const LC_SYMTAB = 0x2;
const LC_SEGMENT_64 = 0x19;

const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
const view = new DataView(bytes.buffer);
const commands = view.getUint32(16, true);
let offset = 32;
let symtab = -1;
let linkedit = -1;
for (let i = 0; i < commands; i++) {
  const command = view.getUint32(offset, true);
  if (command === LC_SYMTAB) symtab = offset;
  if (command === LC_SEGMENT_64 && new TextDecoder().decode(bytes.subarray(offset + 8, offset + 24)).replace(/\0+$/, "") === "__LINKEDIT") linkedit = offset;
  offset += view.getUint32(offset + 4, true);
}
if (symtab < 0 || linkedit < 0) throw new Error(`${path} has no symbol table or __LINKEDIT segment`);

const stringTable = view.getUint32(symtab + 16, true);
const pad = (8 - (stringTable % 8)) % 8;
if (pad === 0) process.exit(0);
const end = stringTable + view.getUint32(symtab + 20, true);
if (bytes.subarray(end).some((byte) => byte !== 0)) throw new Error(`${path} has data after its string table; remove the signature first`);

const fixed = new Uint8Array(bytes.length + pad);
fixed.set(bytes.subarray(0, stringTable));
fixed.set(bytes.subarray(stringTable), stringTable + pad);
const out = new DataView(fixed.buffer);
out.setUint32(symtab + 16, stringTable + pad, true);
const fileSize = out.getBigUint64(linkedit + 48, true) + BigInt(pad);
out.setBigUint64(linkedit + 48, fileSize, true);
if (fileSize > out.getBigUint64(linkedit + 32, true)) out.setBigUint64(linkedit + 32, (fileSize + 0x3fffn) & ~0x3fffn, true);
await Bun.write(path, fixed);
console.log(`aligned the string table of ${path}`);
