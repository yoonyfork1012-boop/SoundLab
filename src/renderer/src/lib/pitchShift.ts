// 재생 속도(길이)는 그대로 두고 피치만 옮기는 오프라인 독립 피치 시프트.
// 1) WSOLA로 피치를 유지한 채 길이를 factor배로 타임스트레치한다.
// 2) 그 결과를 원래 길이로 선형 리샘플링하면, 재생 속도가 factor배 빨라진 것과 같은
//    효과가 나서 피치가 factor배 이동하고 길이는 원본으로 되돌아온다.
//
// 핵심은 (1)에서 프레임을 "이상적인 위치"에 그냥 겹쳐 붙이지 않는다는 것이다. 그렇게 하면
// 겹치는 두 구간의 위상이 매번 어긋나 서로 상쇄/보강되면서 금속성 울림(comb filtering)이
// 생긴다. WSOLA는 이상 위치 주변 ±SEEK 샘플을 훑어 직전 프레임의 꼬리와 가장 잘 이어지는
// 지점을 골라 붙인다 — 이 정렬이 음질의 거의 전부다.

const FRAME = 2048; // 한 번에 복사해 붙이는 프레임 길이
const OVERLAP = 512; // 프레임끼리 크로스페이드하는 구간 길이
const SEEK = 192; // 위상 정렬을 위해 탐색할 최대 샘플 수(±)
const HOP_OUT = FRAME - OVERLAP; // 합성 홉

// 상관도 계산은 전부 훑을 필요가 없다 — 샘플을 솎아내도 최적점 위치는 거의 같고,
// 프레임당 비용이 수십 배 줄어 긴 파일에서도 체감 지연이 없다.
const CORR_STEP = 4;
const SEEK_STEP = 2;

// 0 → 1로 올라가는 raised-cosine 크로스페이드 (등가 파워에 가까워 이음매가 덜 들린다)
const FADE_IN = (() => {
  const w = new Float32Array(OVERLAP);
  for (let i = 0; i < OVERLAP; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((Math.PI * i) / (OVERLAP - 1));
  }
  return w;
})();

// out[outPos..]에 이미 쓰여 있는 직전 프레임의 꼬리와 가장 잘 이어지는 입력 위치를 찾는다.
// 진폭이 큰 구간이 무조건 뽑히지 않도록 후보 구간의 에너지로 정규화한다.
function findBestOffset(
  input: Float32Array,
  out: Float32Array,
  outPos: number,
  ideal: number,
): number {
  const lo = Math.max(0, ideal - SEEK);
  const hi = Math.min(input.length - FRAME, ideal + SEEK);
  if (hi <= lo) return Math.max(0, Math.min(ideal, input.length - FRAME));

  let best = lo;
  let bestScore = -Infinity;
  for (let p = lo; p <= hi; p += SEEK_STEP) {
    let corr = 0;
    let energy = 1e-9;
    for (let j = 0; j < OVERLAP; j += CORR_STEP) {
      const s = input[p + j];
      corr += out[outPos + j] * s;
      energy += s * s;
    }
    const score = corr / Math.sqrt(energy);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

// 모든 채널의 길이를 factor배로 늘리거나 줄인다(피치는 유지).
// 정렬 위치는 첫 채널 하나로만 정하고 나머지 채널에 그대로 적용한다 — 채널마다 따로 정렬하면
// 좌우가 서로 다른 샘플만큼 밀려서 스테레오 이미지가 흔들리고 위상이 깨진다.
function timeStretchChannels(
  channels: Float32Array[],
  factor: number,
): Float32Array[] {
  const length = channels[0].length;
  if (factor === 1 || length < FRAME * 2) return channels;

  const hopIn = HOP_OUT / factor;
  const outLength = Math.ceil(length * factor) + 2 * FRAME + OVERLAP;
  const outs = channels.map(() => new Float32Array(outLength));

  // 첫 프레임은 정렬 기준이 될 직전 프레임이 없으므로 그대로 복사한다
  for (let c = 0; c < channels.length; c++) {
    outs[c].set(channels[c].subarray(0, FRAME), 0);
  }
  let outPos = HOP_OUT;
  let inPosF = hopIn;
  let written = FRAME;
  let lastP = 0;

  while (Math.round(inPosF) + FRAME <= length) {
    const p = findBestOffset(channels[0], outs[0], outPos, Math.round(inPosF));
    for (let c = 0; c < channels.length; c++) {
      const input = channels[c];
      const out = outs[c];
      for (let j = 0; j < OVERLAP; j++) {
        const w = FADE_IN[j];
        out[outPos + j] = out[outPos + j] * (1 - w) + input[p + j] * w;
      }
      out.set(input.subarray(p + OVERLAP, p + FRAME), outPos + OVERLAP);
    }
    written = outPos + FRAME;
    lastP = p;
    outPos += HOP_OUT;
    inPosF += hopIn;
  }

  // 마지막 프레임 뒤에 남은 입력 꼬리를 그대로 이어 붙인다 — 이걸 빼먹으면 사운드 끝의
  // 수십 ms가 잘려나가서, 짧은 원샷 효과음에서 특히 티가 난다.
  const tailStart = lastP + FRAME;
  const tailLength = Math.min(length - tailStart, outLength - written);
  if (tailLength > 0) {
    for (let c = 0; c < channels.length; c++) {
      outs[c].set(
        channels[c].subarray(tailStart, tailStart + tailLength),
        written,
      );
    }
    written += tailLength;
  }

  const end = Math.max(1, written);
  return outs.map((out) => out.slice(0, end));
}

function resampleLinear(input: Float32Array, outLength: number): Float32Array {
  const output = new Float32Array(outLength);
  if (input.length < 2 || outLength < 1) return output;
  const ratio = (input.length - 1) / Math.max(1, outLength - 1);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx];
    const b = input[idx + 1] ?? a;
    output[i] = a + (b - a) * frac;
  }
  return output;
}

// semitones > 0: 피치 올림, < 0: 피치 내림. 길이(재생 시간)는 변하지 않는다.
export function pitchShiftChannels(
  channels: Float32Array[],
  semitones: number,
): Float32Array[] {
  if (semitones === 0 || channels.length === 0) return channels;
  const factor = Math.pow(2, semitones / 12);
  const length = channels[0].length;

  // WSOLA 타임스트레치는 FRAME*2(≈93ms) 미만이면 원본을 그대로 돌려주므로, 그 뒤의
  // "원래 길이로 리샘플"이 항등 연산이 되어 짧은 클릭/트랜지언트에는 피치가 전혀 안 걸린다.
  // 그런 짧은 버퍼는 타임스트레치를 건너뛰고 직접 리샘플로 피치를 옮긴다. length/factor
  // 샘플로 리샘플하면 factor배 빠르게 재생한 것과 같아 피치가 factor배 이동한다.
  // 트레이드오프: 이 경로에서는 길이가 factor만큼 바뀐다(피치↑ = 길이↓). 93ms 미만
  // 원샷에서는 테이프처럼 자연스러운 편이라 무음보다 낫다.
  if (length < FRAME * 2) {
    if (length < 2) return channels; // 리샘플 불가 — 그대로 둔다
    const outLength = Math.max(1, Math.round(length / factor));
    return channels.map((data) => resampleLinear(data, outLength));
  }

  return timeStretchChannels(channels, factor).map((data) =>
    resampleLinear(data, length),
  );
}
