// 다중 크기 Windows 아이콘 생성: npx electron scripts/make-ico.cjs build/icon.png build/icon.ico
// (electron-builder가 PNG에서 만드는 ico는 256px 프레임 하나뿐이라 작업 표시줄 아이콘이 빈다)
const { app, nativeImage } = require("electron");
const fs = require("fs");
const [inFile, outFile] = process.argv.slice(-2);
app.whenReady().then(() => {
  const src = nativeImage.createFromPath(inFile);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const frames = sizes.map((s) => {
    const img = src.resize({ width: s, height: s, quality: "best" });
    if (s >= 64) return { s, data: img.toPNG() };
    // 32bpp BITMAPINFOHEADER + BGRA(아래→위) + AND 마스크(전부 0 = 알파 사용)
    const bgra = img.toBitmap(); // 위→아래, BGRA
    const row = s * 4, maskRow = Math.ceil(s / 32) * 4;
    const hdr = Buffer.alloc(40);
    hdr.writeUInt32LE(40, 0); hdr.writeInt32LE(s, 4); hdr.writeInt32LE(s * 2, 8);
    hdr.writeUInt16LE(1, 12); hdr.writeUInt16LE(32, 14); hdr.writeUInt32LE(0, 16);
    hdr.writeUInt32LE(row * s + maskRow * s, 20);
    const px = Buffer.alloc(row * s);
    for (let y = 0; y < s; y++) bgra.copy(px, (s - 1 - y) * row, y * row, (y + 1) * row);
    return { s, data: Buffer.concat([hdr, px, Buffer.alloc(maskRow * s)]) };
  });
  const head = Buffer.alloc(6 + 16 * frames.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(frames.length, 4);
  let off = head.length;
  frames.forEach((f, i) => {
    const o = 6 + 16 * i;
    head.writeUInt8(f.s >= 256 ? 0 : f.s, o); head.writeUInt8(f.s >= 256 ? 0 : f.s, o + 1);
    head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(f.data.length, o + 8); head.writeUInt32LE(off, o + 12);
    off += f.data.length;
  });
  fs.writeFileSync(outFile, Buffer.concat([head, ...frames.map((f) => f.data)]));
  app.quit();
});
