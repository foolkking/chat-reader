import { deflateSync } from "node:zlib";

/** Deterministic synthetic screenshots: legible labels, table rules, diagram
 * blocks and alpha. No downloaded media or real conversation content. */
export function syntheticImage(width: number, height: number, transparent = false) {
  const stride = width * 4 + 1, pixels = Buffer.alloc(stride * height, 255);
  for (let y = 0; y < height; y++) {
    pixels[y * stride] = 0;
    if (transparent) for (let x = 0; x < width; x++) pixels[y * stride + 1 + x * 4 + 3] = 0;
  }
  function rect(x: number, y: number, w: number, h: number, color: number[]) {
    for (let row = Math.max(0, y); row < Math.min(height, y + h); row++)
      for (let col = Math.max(0, x); col < Math.min(width, x + w); col++) {
        const offset = row * stride + 1 + col * 4;
        for (let channel = 0; channel < 4; channel++) pixels[offset + channel] = color[channel] ?? 255;
      }
  }
  const font: Record<string, string[]> = {
    S: ["111", "100", "111", "001", "111"], A: ["010", "101", "111", "101", "101"],
    M: ["101", "111", "111", "101", "101"], P: ["110", "101", "110", "100", "100"],
    L: ["100", "100", "100", "100", "111"], E: ["111", "100", "110", "100", "111"],
    "1": ["010", "110", "010", "010", "111"], "2": ["110", "001", "010", "100", "111"],
    "3": ["110", "001", "010", "001", "110"], "4": ["101", "101", "111", "001", "001"],
  };
  const unit = Math.max(1, Math.min(5, Math.floor(width / 160)));
  function text(value: string, x: number, y: number) {
    for (const char of value) {
      font[char]?.forEach((line, row) => [...line].forEach((dot, col) => {
        if (dot === "1") rect(x + col * unit, y + row * unit, unit, unit, [35, 45, 42]);
      }));
      x += 4 * unit;
    }
  }
  rect(0, 0, width, 2, [38, 90, 76]);
  for (let y = 6; y < height; y += 80 * unit) {
    text("SAMPLE 1234", 4, y);
    for (let row = 0; row < 4; row++) {
      const top = y + (10 + row * 10) * unit;
      rect(4, top, width - 8, 1, [130, 142, 136]);
      for (let col = 0; col < 3; col++) rect(4 + Math.floor((width - 8) * col / 3), top, 1, 10 * unit, [130, 142, 136]);
      text(String(row + 1), 8, top + 2 * unit);
    }
    rect(6, y + 56 * unit, Math.floor(width / 3), 10 * unit, [130, 190, 165, 160]);
    rect(Math.floor(width / 2), y + 56 * unit, Math.floor(width / 3), 10 * unit, [200, 155, 100, 220]);
  }
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name), crcBytes = Buffer.concat([type, data]);
    let crc = 0xffffffff;
    for (const byte of crcBytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, type, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
