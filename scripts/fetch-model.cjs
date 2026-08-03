// 의미 검색용 임베딩 모델을 build/models로 받는다.
//
// 약 130MB라 저장소에 넣지 않는다(.gitignore). 대신 여기서 받아 두면 electron-builder가
// extraResources로 설치본에 동봉한다. 앱은 이 파일만 쓰고 런타임에 네트워크로 나가지
// 않는다 — 오프라인 전용 원칙(CLAUDE.md).
const {
  mkdirSync,
  existsSync,
  createWriteStream,
  statSync,
} = require("node:fs");
const { join, dirname } = require("node:path");
const https = require("node:https");

const REPO = "Xenova/multilingual-e5-small";
const BASE = `https://huggingface.co/${REPO}/resolve/main`;
const DEST = join(__dirname, "..", "build", "models", "multilingual-e5-small");

// 토크나이저 + 설정 + int8 양자화 ONNX. fp32(470MB)는 쓰지 않는다.
const FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "onnx/model_quantized.onnx",
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        // HuggingFace는 실제 파일을 CDN으로 리다이렉트한다
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          return download(res.headers.location, dest).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`${url} → HTTP ${res.statusCode}`));
        }
        mkdirSync(dirname(dest), { recursive: true });
        const out = createWriteStream(dest);
        res.pipe(out);
        out.on("finish", () => out.close(resolve));
        out.on("error", reject);
      })
      .on("error", reject);
  });
}

(async () => {
  for (const rel of FILES) {
    const dest = join(DEST, rel);
    if (existsSync(dest) && statSync(dest).size > 0) {
      console.log(`이미 있음: ${rel}`);
      continue;
    }
    console.log(`받는 중: ${rel}`);
    await download(`${BASE}/${rel}`, dest);
    console.log(`  ${(statSync(dest).size / 1048576).toFixed(1)} MB`);
  }
  console.log("모델 준비 완료:", DEST);
})().catch((err) => {
  console.error("모델 내려받기 실패:", err.message);
  process.exit(1);
});
