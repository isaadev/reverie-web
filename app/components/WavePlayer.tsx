'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface Props {
  src:        string;
  filename:   string;
  onDownload: () => void;
}

const BAR_COUNT = 48;
const BAR_GAP   = 2.5;
const LERP      = 0.18; // smoothing factor (0 = instant, 1 = never moves)

const IDLE_HEIGHTS = Array.from({ length: BAR_COUNT }, (_, i) =>
  0.15 + 0.35 * Math.abs(Math.sin(i * 0.42 + 1.1)) * Math.abs(Math.cos(i * 0.17))
);

export default function WavePlayer({ src, filename: _filename, onDownload }: Props) {
  const audioRef    = useRef<HTMLAudioElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef      = useRef<number>(0);
  const ctxRef      = useRef<AudioContext | null>(null);
  const sourceRef   = useRef<MediaElementAudioSourceNode | null>(null);
  const playingRef  = useRef(false);
  const smoothed    = useRef<Float32Array>(new Float32Array(BAR_COUNT).fill(0));

  const [playing,  setPlaying]  = useState(false);
  const [progress, setProgress] = useState(0);
  const [current,  setCurrent]  = useState(0);
  const [duration, setDuration] = useState(0);

  // ── Match canvas pixel size to its CSS size ───────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sync = () => {
      const dpr    = window.devicePixelRatio || 1;
      canvas.width  = canvas.offsetWidth  * dpr;
      canvas.height = canvas.offsetHeight * dpr;
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // ── Wire Web Audio on first play ──────────────────────────────────────────
  const ensureAudioGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || sourceRef.current) return;
    const actx     = new AudioContext();
    const source   = actx.createMediaElementSource(audio);
    const analyser = actx.createAnalyser();
    analyser.fftSize        = 128;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    analyser.connect(actx.destination);
    ctxRef.current      = actx;
    sourceRef.current   = source;
    analyserRef.current = analyser;
  }, []);

  // ── Draw loop (never recreated — uses refs only) ──────────────────────────
  const draw = useCallback(() => {
    const canvas   = canvasRef.current;
    if (!canvas) { rafRef.current = requestAnimationFrame(draw); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx)  { rafRef.current = requestAnimationFrame(draw); return; }

    const W   = canvas.width;
    const H   = canvas.height;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, W, H);

    const barW    = (W - BAR_GAP * dpr * (BAR_COUNT - 1)) / BAR_COUNT;
    const isLive  = playingRef.current && analyserRef.current;

    let targets: number[];
    if (isLive && analyserRef.current) {
      const raw = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(raw);
      targets = Array.from({ length: BAR_COUNT }, (_, i) => {
        const bin = Math.floor((i / BAR_COUNT) * raw.length);
        return raw[bin] / 255;
      });
    } else {
      // Breathing idle animation
      const t = Date.now() / 1200;
      targets = IDLE_HEIGHTS.map((h, i) => h * (0.6 + 0.4 * Math.sin(t + i * 0.3)));
    }

    // Lerp smoothed values toward targets
    for (let i = 0; i < BAR_COUNT; i++) {
      smoothed.current[i] += (targets[i] - smoothed.current[i]) * LERP;
    }

    for (let i = 0; i < BAR_COUNT; i++) {
      const v    = smoothed.current[i];
      const barH = Math.max(2 * dpr, v * H * 0.92);
      const x    = i * (barW + BAR_GAP * dpr);
      const y    = (H - barH) / 2;
      const r    = Math.min(barW / 2, 3 * dpr);

      // Gradient: dim purple → bright purple based on amplitude
      const alpha = isLive ? 0.25 + v * 0.75 : 0.18 + v * 0.3;
      const light = isLive ? Math.floor(92 + v * 80)  : 92;
      ctx.fillStyle = `rgba(${isLive ? `${80 + Math.floor(v*60)}, ${40 + Math.floor(v*30)}, ${light}` : '60, 31, 94'}, ${alpha})`;

      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, r);
      ctx.fill();

      // Glow on loud bars when playing
      if (isLive && v > 0.6) {
        ctx.shadowColor = `rgba(139, 92, 246, ${(v - 0.6) * 0.8})`;
        ctx.shadowBlur  = 8 * dpr;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    rafRef.current = requestAnimationFrame(draw);
  }, []); // no deps — uses only refs

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  // ── Audio events ──────────────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime   = () => {
      setCurrent(audio.currentTime);
      setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
    };
    const onMeta   = () => setDuration(audio.duration);
    const onEnded  = () => {
      playingRef.current = false;
      setPlaying(false);
      setProgress(0);
      audio.currentTime = 0;
    };
    audio.addEventListener('timeupdate',    onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended',         onEnded);
    return () => {
      audio.removeEventListener('timeupdate',    onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended',         onEnded);
    };
  }, []);

  useEffect(() => {
    playingRef.current = false;
    setPlaying(false);
    setProgress(0);
    setCurrent(0);
  }, [src]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    ensureAudioGraph();
    if (ctxRef.current?.state === 'suspended') await ctxRef.current.resume();
    if (playing) {
      audio.pause();
      playingRef.current = false;
      setPlaying(false);
    } else {
      await audio.play();
      playingRef.current = true;
      setPlaying(true);
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio?.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
  };

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    <div style={s.wrap}>
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Waveform */}
      <canvas ref={canvasRef} style={s.canvas} />

      {/* Seek bar */}
      <div style={s.seekTrack} onClick={seek}>
        <div style={{ ...s.seekFill, width: `${progress * 100}%` }} />
        <div style={{ ...s.seekThumb, left: `calc(${progress * 100}% - 5px)` }} />
      </div>

      {/* Time */}
      <div style={s.times}>
        <span>{fmt(current)}</span>
        <span style={{ color: 'var(--faint)' }}>{duration ? fmt(duration) : '--:--'}</span>
      </div>

      {/* Controls */}
      <div style={s.controls}>
        <button style={{ ...s.playBtn, ...(playing ? s.playBtnActive : {}) }} onClick={togglePlay}>
          {playing ? '⏸' : '▶'}
        </button>
        <button style={s.dlBtn} onClick={onDownload}>
          ⬇ save mp3
        </button>
      </div>
    </div>
  );
}

const PURPLE = '#8b5cf6';

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
    height: 80,
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
    transition: 'width 0.1s linear',
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
    transition: 'left 0.1s linear',
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
    transition: 'all 0.15s',
  },
  playBtnActive: {
    background: 'var(--purple-dk)',
    borderColor: PURPLE,
    boxShadow: `0 0 10px rgba(139,92,246,0.3)`,
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
