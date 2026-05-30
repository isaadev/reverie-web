'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface Props {
  src: string;        // blob URL or audio URL
  filename: string;
  onDownload: () => void;
}

const BAR_COUNT  = 40;
const BAR_GAP    = 2;
const PURPLE     = '#8b5cf6';
const PURPLE_DIM = '#2e1f5e';

export default function WavePlayer({ src, filename, onDownload }: Props) {
  const audioRef    = useRef<HTMLAudioElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef      = useRef<number>(0);
  const ctxRef      = useRef<AudioContext | null>(null);
  const sourceRef   = useRef<MediaElementAudioSourceNode | null>(null);

  const [playing,  setPlaying]  = useState(false);
  const [progress, setProgress] = useState(0);   // 0–1
  const [current,  setCurrent]  = useState(0);
  const [duration, setDuration] = useState(0);

  // ── Wire Web Audio on first play ─────────────────────────────────────────────
  const ensureAudioGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || sourceRef.current) return;

    const actx     = new AudioContext();
    const source   = actx.createMediaElementSource(audio);
    const analyser = actx.createAnalyser();
    analyser.fftSize = 128;
    source.connect(analyser);
    analyser.connect(actx.destination);

    ctxRef.current    = actx;
    sourceRef.current = source;
    analyserRef.current = analyser;
  }, []);

  // ── Canvas draw loop ─────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas   = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (analyser) {
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);

      const barW = (W - BAR_GAP * (BAR_COUNT - 1)) / BAR_COUNT;
      for (let i = 0; i < BAR_COUNT; i++) {
        // Map bar index to frequency bin
        const binIdx = Math.floor((i / BAR_COUNT) * data.length);
        const v      = data[binIdx] / 255;
        const barH   = Math.max(3, v * H);
        const x      = i * (barW + BAR_GAP);
        const y      = (H - barH) / 2;

        const alpha = 0.4 + v * 0.6;
        ctx.fillStyle = playing
          ? `rgba(139, 92, 246, ${alpha})`
          : PURPLE_DIM;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, barW / 2);
        ctx.fill();
      }
    } else {
      // Static idle bars
      const barW = (W - BAR_GAP * (BAR_COUNT - 1)) / BAR_COUNT;
      const idle = [0.3,0.5,0.4,0.7,0.55,0.45,0.65,0.35,0.6,0.5,
                    0.4,0.7,0.3,0.55,0.45,0.65,0.5,0.4,0.35,0.6,
                    0.5,0.45,0.65,0.35,0.55,0.7,0.4,0.3,0.6,0.5,
                    0.45,0.65,0.35,0.55,0.5,0.4,0.7,0.3,0.6,0.45];
      for (let i = 0; i < BAR_COUNT; i++) {
        const barH = Math.max(3, (idle[i] ?? 0.4) * H * 0.6);
        const x    = i * (barW + BAR_GAP);
        const y    = (H - barH) / 2;
        ctx.fillStyle = PURPLE_DIM;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, barW / 2);
        ctx.fill();
      }
    }

    rafRef.current = requestAnimationFrame(draw);
  }, [playing]);

  // Start / stop RAF
  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  // ── Audio events ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      setCurrent(audio.currentTime);
      setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
    };
    const onLoaded  = () => setDuration(audio.duration);
    const onEnded   = () => { setPlaying(false); setProgress(0); audio.currentTime = 0; };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  // Reset when src changes
  useEffect(() => {
    setPlaying(false);
    setProgress(0);
    setCurrent(0);
  }, [src]);

  // ── Controls ─────────────────────────────────────────────────────────────────
  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    ensureAudioGraph();
    if (ctxRef.current?.state === 'suspended') await ctxRef.current.resume();

    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      await audio.play();
      setPlaying(true);
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct  = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div style={s.wrap}>
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* ── Waveform canvas ── */}
      <canvas
        ref={canvasRef}
        width={372}
        height={64}
        style={s.canvas}
      />

      {/* ── Seek bar ── */}
      <div style={s.seekTrack} onClick={seek}>
        <div style={{ ...s.seekFill, width: `${progress * 100}%` }} />
        <div style={{ ...s.seekThumb, left: `calc(${progress * 100}% - 5px)` }} />
      </div>

      {/* ── Time ── */}
      <div style={s.times}>
        <span>{fmt(current)}</span>
        <span style={{ color: 'var(--faint)' }}>{duration ? fmt(duration) : '--:--'}</span>
      </div>

      {/* ── Buttons ── */}
      <div style={s.controls}>
        <button style={s.playBtn} onClick={togglePlay}>
          {playing ? '⏸' : '▶'}
        </button>
        <button style={s.dlBtn} onClick={onDownload}>
          ⬇ save mp3
        </button>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '14px 14px 12px',
  },
  canvas: {
    width: '100%',
    height: 64,
    borderRadius: 6,
  },
  seekTrack: {
    position: 'relative',
    height: 3,
    background: 'var(--border)',
    borderRadius: 999,
    cursor: 'pointer',
    marginTop: 2,
  },
  seekFill: {
    position: 'absolute',
    top: 0, left: 0, height: '100%',
    background: PURPLE,
    borderRadius: 999,
    pointerEvents: 'none',
  },
  seekThumb: {
    position: 'absolute',
    top: -3.5,
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: PURPLE,
    pointerEvents: 'none',
    boxShadow: '0 0 6px rgba(139,92,246,0.6)',
  },
  times: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 10,
    color: 'var(--muted)',
  },
  controls: {
    display: 'flex',
    gap: 8,
    marginTop: 2,
  },
  playBtn: {
    width: 40,
    height: 36,
    borderRadius: 8,
    background: 'var(--surface2)',
    border: '1px solid var(--border2)',
    color: 'var(--purple-hi)',
    fontSize: 16,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  dlBtn: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    background: 'linear-gradient(135deg, #6d28d9, #7c3aed)',
    border: '1px solid #8b5cf6',
    color: '#fff',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    letterSpacing: 1,
  },
};
