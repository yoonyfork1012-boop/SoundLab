import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Track } from "@shared/types";
import type { PlayerHandle } from "../PlayerBar/PlayerBar";
import { loadBool, saveBool } from "../../lib/uiState";

interface AnalysisPanelProps {
  playerRef: RefObject<PlayerHandle>;
  track: Track | null;
}

const PEAK_MIN_DB = -60;
const DISPLAY_FLOOR_DB = -100; // 감쇠 값이 한없이 내려가지 않도록 두는 바닥값
const PEAK_DECAY_DB_PER_SEC = 24;
const WIDTH_SMOOTHING = 0.15;
const CORRELATION_SMOOTHING = 0.2;
const GONIO_W = 240;
const GONIO_H = 128;
const GONIO_STRIDE = 4; // 샘플을 매번 다 찍지 않고 몇 개 건너뛰며 찍어 프레임당 연산을 줄임
const GONIO_FADE = 0.14; // 잔상(트레일) 지속 정도 — 클수록 빨리 사라짐

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function dbToPct(db: number, minDb: number): number {
  if (!isFinite(db)) return 0;
  return clampPct(((db - minDb) / (0 - minDb)) * 100);
}

function fmtDb(db: number | null, floor = PEAK_MIN_DB): string {
  if (db == null || !isFinite(db) || db <= floor) return "-∞";
  return db.toFixed(1);
}

// 순간 진폭(0~1)을 dBFS로. 무음(0)이면 표시 불가(null)를 반환.
function dbfsFromAmplitude(peak: number): number | null {
  return peak > 0 ? 20 * Math.log10(peak) : null;
}

export default function AnalysisPanel({
  playerRef,
  track,
}: AnalysisPanelProps): JSX.Element {
  const [open, setOpen] = useState(() =>
    loadBool("soundlib.analysis.open", true),
  );
  const [peakOn, setPeakOn] = useState(() =>
    loadBool("soundlib.analysis.peak", true),
  );
  const [widthOn, setWidthOn] = useState(() =>
    loadBool("soundlib.analysis.width", true),
  );

  // 애니메이션 프레임마다(초당 60회) React state를 갱신하면 렌더 폭주가 나므로,
  // 미터 값은 DOM에 직접 반영한다(ref로 잡은 엘리먼트의 style/textContent만 갱신).
  const barLRef = useRef<HTMLDivElement>(null);
  const barRRef = useRef<HTMLDivElement>(null);
  const holdLRef = useRef<HTMLDivElement>(null);
  const holdRRef = useRef<HTMLDivElement>(null);
  const valLRef = useRef<HTMLSpanElement>(null);
  const valRRef = useRef<HTMLSpanElement>(null);

  const gonioBgCanvasRef = useRef<HTMLCanvasElement>(null);
  const gonioFgCanvasRef = useRef<HTMLCanvasElement>(null);
  const corrNeedleRef = useRef<HTMLDivElement>(null);
  const widthValRef = useRef<HTMLSpanElement>(null);
  const corrValRef = useRef<HTMLSpanElement>(null);

  const meterState = useRef({
    peakL: -Infinity,
    peakR: -Infinity,
    // holdL/holdR: 재생 중 측정된 "역대 최고" 값 — 새로 더 높은 피크가 감지될 때만 올라가고,
    // Reset을 누르거나 트랙이 바뀌기 전까지는 절대 내려가지 않는다.
    holdL: -Infinity,
    holdR: -Infinity,
    widthPct: 0,
    correlation: 1,
    lastFrameTs: 0,
  });

  function resetPeakHold(): void {
    meterState.current.holdL = -Infinity;
    meterState.current.holdR = -Infinity;
  }

  // Stereo Width 반원(Soundminer 스타일) 배경 그리드는 값이 안 바뀌므로 한 번만 그려서
  // 별도 캔버스(bg)에 고정해 두고, 실시간 점(fg)만 매 프레임 갱신한다.
  useEffect(() => {
    const bg = gonioBgCanvasRef.current;
    if (!bg) return;
    const ctx = bg.getContext("2d");
    if (!ctx) return;
    const cx = GONIO_W / 2;
    const cy = GONIO_H - 8;
    const r = Math.min(GONIO_W / 2 - 18, GONIO_H) - 10;
    ctx.clearRect(0, 0, GONIO_W, GONIO_H);
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.arc(cx, cy, r * 0.5, Math.PI, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);
    [-90, -45, 0, 45, 90].forEach((deg) => {
      const rad = (deg * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + r * Math.sin(rad), cy - r * Math.cos(rad));
      ctx.strokeStyle =
        deg === 0 ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.16)";
      ctx.stroke();
    });
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("L", cx - r - 8, cy + 3);
    ctx.fillText("C", cx, cy - r - 6);
    ctx.fillText("R", cx + r + 8, cy + 3);
  }, []);

  // 트랙이 바뀌면 Peak Hold 등 누적치를 리셋한다
  useEffect(() => {
    const st = meterState.current;
    st.peakL = -Infinity;
    st.peakR = -Infinity;
    st.holdL = -Infinity;
    st.holdR = -Infinity;
    st.widthPct = 0;
    st.correlation = 1;
  }, [track?.id]);

  useEffect(() => {
    if (!open) return;

    function applyBarWidth(el: HTMLDivElement | null, pct: number): void {
      if (el) el.style.width = `${pct}%`;
    }
    function applyHoldLeft(el: HTMLDivElement | null, pct: number): void {
      if (el) el.style.left = `${pct}%`;
    }
    function setText(el: HTMLSpanElement | null, text: string): void {
      if (el && el.textContent !== text) el.textContent = text;
    }
    // accent 색상은 사용자가 바꿀 수 있으므로(AccentPicker) 매번 CSS 변수에서 읽어온다
    function accentColor(alpha: number): string {
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue("--accent-bright")
        .trim();
      return v
        ? `color-mix(in srgb, ${v} ${Math.round(alpha * 100)}%, transparent)`
        : `rgba(163,227,193,${alpha})`;
    }
    function fadeGonio(): void {
      const fg = gonioFgCanvasRef.current;
      const ctx = fg?.getContext("2d");
      if (!ctx || !fg) return;
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0,0,0,${GONIO_FADE})`;
      ctx.fillRect(0, 0, fg.width, fg.height);
      ctx.globalCompositeOperation = "source-over";
    }
    function drawGonio(bL: Float32Array, bR: Float32Array): void {
      const fg = gonioFgCanvasRef.current;
      const ctx = fg?.getContext("2d");
      if (!ctx || !fg) return;
      fadeGonio();
      const cx = fg.width / 2;
      const cy = fg.height - 8;
      const r = Math.min(fg.width / 2 - 18, fg.height) - 10;
      ctx.fillStyle = accentColor(0.85);
      const n = Math.min(bL.length, bR.length);
      for (let i = 0; i < n; i += GONIO_STRIDE) {
        const mid = (bL[i] + bR[i]) * 0.5;
        const side = (bL[i] - bR[i]) * 0.5;
        const x = cx + side * r;
        const y = cy - Math.abs(mid) * r;
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }
    function applyCorrelation(corr: number): void {
      const pct = clampPct(((corr + 1) / 2) * 100);
      if (corrNeedleRef.current) corrNeedleRef.current.style.left = `${pct}%`;
      if (corrValRef.current)
        corrValRef.current.textContent = isFinite(corr) ? corr.toFixed(2) : "—";
    }
    function renderIdle(): void {
      if (peakOn) {
        applyBarWidth(barLRef.current, 0);
        applyBarWidth(barRRef.current, 0);
        // 정지/무음 상태에서도 Peak Hold 숫자는 그대로 유지(감쇠하지 않음)
        setText(
          valLRef.current,
          fmtDb(
            isFinite(meterState.current.holdL)
              ? meterState.current.holdL
              : null,
          ),
        );
        setText(
          valRRef.current,
          fmtDb(
            isFinite(meterState.current.holdR)
              ? meterState.current.holdR
              : null,
          ),
        );
      }
      if (widthOn) {
        fadeGonio();
        applyCorrelation(1);
        setText(widthValRef.current, "—");
      }
    }

    let raf = 0;
    const bufL = new Float32Array(2048);
    const bufR = new Float32Array(2048);

    function tick(ts: number): void {
      raf = requestAnimationFrame(tick);
      const tap = playerRef.current?.getMeterTap();
      const st = meterState.current;
      const dt = st.lastFrameTs ? ts - st.lastFrameTs : 16;
      st.lastFrameTs = ts;

      if (!tap) {
        renderIdle();
        return;
      }

      if (peakOn) {
        // AnalyserNode는 재생이 멈춰도 마지막으로 받은 샘플을 계속 돌려주므로(새 데이터가
        // 없을 뿐 "무음"이 되는 게 아님), 실제로 재생 중일 때만 읽고 그 외에는 무음(-Infinity)
        // 으로 취급한다. 이렇게 해야 정지 후 막대가 마지막 값에 얼어붙지 않고 바닥으로 감쇠한다.
        let dbL = -Infinity;
        let dbR = -Infinity;
        if (tap.isPlaying) {
          tap.analyserL.getFloatTimeDomainData(bufL);
          let maxL = 0;
          for (let i = 0; i < bufL.length; i++) {
            const a = Math.abs(bufL[i]);
            if (a > maxL) maxL = a;
          }
          dbL = dbfsFromAmplitude(maxL) ?? -Infinity;
          dbR = dbL;

          if (!tap.isMono) {
            tap.analyserR.getFloatTimeDomainData(bufR);
            let maxR = 0;
            for (let i = 0; i < bufR.length; i++) {
              const a = Math.abs(bufR[i]);
              if (a > maxR) maxR = a;
            }
            dbR = dbfsFromAmplitude(maxR) ?? -Infinity;
          }
        }

        // 막대는 빠른 attack + 느린 release로 실시간 레벨을 보여준다(표준 미터 탄도 특성).
        // 무음이 오래 지속돼도 값이 한없이 내려가지 않도록 DISPLAY_FLOOR_DB로 바닥을 둔다.
        const decay = (PEAK_DECAY_DB_PER_SEC * dt) / 1000;
        st.peakL =
          dbL > st.peakL ? dbL : Math.max(DISPLAY_FLOOR_DB, st.peakL - decay);
        st.peakR =
          dbR > st.peakR ? dbR : Math.max(DISPLAY_FLOOR_DB, st.peakR - decay);

        // Peak Hold(숫자+마커)는 감쇠 없이 "역대 최고"만 계속 갱신 — Reset/트랙 변경 전까지 유지
        if (dbL > st.holdL) st.holdL = dbL;
        if (dbR > st.holdR) st.holdR = dbR;

        applyBarWidth(barLRef.current, dbToPct(st.peakL, PEAK_MIN_DB));
        applyBarWidth(barRRef.current, dbToPct(st.peakR, PEAK_MIN_DB));
        applyHoldLeft(holdLRef.current, dbToPct(st.holdL, PEAK_MIN_DB));
        applyHoldLeft(holdRRef.current, dbToPct(st.holdR, PEAK_MIN_DB));
        barLRef.current?.classList.toggle(
          "analysis__hbar-fill--clip",
          dbL > -1,
        );
        barRRef.current?.classList.toggle(
          "analysis__hbar-fill--clip",
          dbR > -1,
        );
        setText(valLRef.current, fmtDb(isFinite(st.holdL) ? st.holdL : null));
        setText(valRRef.current, fmtDb(isFinite(st.holdR) ? st.holdR : null));
      }

      if (widthOn) {
        if (!tap.isPlaying) {
          // 정지 중에는 새 오디오 데이터가 없으므로 폭/위상을 중립값(0%, +1)으로 서서히
          // 되돌리고, 잔상 트레일도 지워 이미저가 "멈춘 그림에 얼어붙는" 대신 초기화되게 한다.
          st.widthPct += (0 - st.widthPct) * WIDTH_SMOOTHING;
          st.correlation += (1 - st.correlation) * CORRELATION_SMOOTHING;
          fadeGonio();
          applyCorrelation(st.correlation);
          setText(widthValRef.current, "—");
        } else {
          tap.analyserL.getFloatTimeDomainData(bufL);
          if (tap.isMono) {
            // 모노 파일은 채널 스플리터의 두 번째 출력이 무음이라(g1에 실제 신호가 없음)
            // bufR을 그대로 읽으면 있지도 않은 스테레오 폭이 있는 것처럼 보인다. 실제로
            // 양쪽 스피커에서 들리는 소리(L 그대로)를 R에도 복제해야 정중앙(Mono)으로 표시된다.
            bufR.set(bufL);
          } else {
            tap.analyserR.getFloatTimeDomainData(bufR);
          }
          let midSum = 0;
          let sideSum = 0;
          let sumLR = 0;
          let sumLL = 0;
          let sumRR = 0;
          const n = Math.min(bufL.length, bufR.length);
          for (let i = 0; i < n; i++) {
            const l = bufL[i];
            const r = bufR[i];
            const mid = (l + r) * 0.5;
            const side = (l - r) * 0.5;
            midSum += mid * mid;
            sideSum += side * side;
            sumLR += l * r;
            sumLL += l * l;
            sumRR += r * r;
          }
          const midRms = Math.sqrt(midSum / n);
          const sideRms = Math.sqrt(sideSum / n);
          const widthDenom = midRms + sideRms;
          const instantWidth =
            widthDenom > 1e-9 ? clampPct((sideRms / widthDenom) * 100) : 0;
          st.widthPct += (instantWidth - st.widthPct) * WIDTH_SMOOTHING;

          const corrDenom = Math.sqrt(sumLL * sumRR);
          const instantCorr = corrDenom > 1e-9 ? sumLR / corrDenom : 1;
          st.correlation +=
            (instantCorr - st.correlation) * CORRELATION_SMOOTHING;

          drawGonio(bufL, bufR);
          applyCorrelation(st.correlation);
          setText(
            widthValRef.current,
            tap.isMono ? "Mono" : `${Math.round(st.widthPct)}%`,
          );
        }
      }
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, peakOn, widthOn, playerRef]);

  function toggle(
    key: string,
    current: boolean,
    setter: (v: boolean) => void,
  ): void {
    const next = !current;
    setter(next);
    saveBool(key, next);
  }

  return (
    <section className="analysis">
      <div className="analysis__header">
        <span className="analysis__title">Analysis</span>
        <div className="analysis__toggles">
          <button
            className={`analysis__chip${peakOn ? " analysis__chip--on" : ""}`}
            onClick={() => toggle("soundlib.analysis.peak", peakOn, setPeakOn)}
            title="Peak Level 표시/숨김"
          >
            Peak
          </button>
          <button
            className={`analysis__chip${widthOn ? " analysis__chip--on" : ""}`}
            onClick={() =>
              toggle("soundlib.analysis.width", widthOn, setWidthOn)
            }
            title="Stereo Width 표시/숨김"
          >
            Width
          </button>
          <button
            className="analysis__collapse"
            onClick={() => toggle("soundlib.analysis.open", open, setOpen)}
            title={open ? "분석 패널 접기" : "분석 패널 펼치기"}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: open ? "rotate(0deg)" : "rotate(180deg)" }}
            >
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="analysis__body">
          {!track && <div className="analysis__empty">No sound selected</div>}

          {track && peakOn && (
            <div className="analysis__group">
              <div className="analysis__group-label-row">
                <div className="analysis__group-label">
                  Peak Level <span className="analysis__unit">dBFS</span>
                </div>
                <button
                  className="analysis__reset-btn"
                  onClick={resetPeakHold}
                  title="Peak Hold 초기화"
                >
                  Reset
                </button>
              </div>
              <div className="analysis__hbars">
                <div className="analysis__hbar-row">
                  <span className="analysis__hbar-label">L</span>
                  <div className="analysis__hbar-track">
                    <div className="analysis__hbar-fill" ref={barLRef} />
                    <div className="analysis__hbar-hold" ref={holdLRef} />
                  </div>
                  <span className="analysis__hbar-val" ref={valLRef}>
                    -∞
                  </span>
                </div>
                <div className="analysis__hbar-row">
                  <span className="analysis__hbar-label">R</span>
                  <div className="analysis__hbar-track">
                    <div className="analysis__hbar-fill" ref={barRRef} />
                    <div className="analysis__hbar-hold" ref={holdRRef} />
                  </div>
                  <span className="analysis__hbar-val" ref={valRRef}>
                    -∞
                  </span>
                </div>
              </div>
            </div>
          )}

          {track && widthOn && (
            <div className="analysis__group">
              <div className="analysis__group-label">Stereo Image</div>
              <div className="analysis__gonio">
                <div
                  className="analysis__gonio-canvases"
                  style={{ aspectRatio: `${GONIO_W} / ${GONIO_H}` }}
                >
                  <canvas
                    className="analysis__gonio-canvas"
                    ref={gonioBgCanvasRef}
                    width={GONIO_W}
                    height={GONIO_H}
                  />
                  <canvas
                    className="analysis__gonio-canvas"
                    ref={gonioFgCanvasRef}
                    width={GONIO_W}
                    height={GONIO_H}
                  />
                </div>
                <div className="analysis__gonio-readouts">
                  <span>
                    Width <b ref={widthValRef}>—</b>
                  </span>
                  <span>
                    Phase <b ref={corrValRef}>—</b>
                  </span>
                </div>
                <div className="analysis__corr-track">
                  <div className="analysis__corr-center" />
                  <div className="analysis__corr-needle" ref={corrNeedleRef} />
                </div>
                <div className="analysis__corr-scale">
                  <span>-1 Out of Phase</span>
                  <span>0</span>
                  <span>+1 In Phase</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
