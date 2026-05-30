'use client';

import { useState, useCallback, useRef } from 'react';
import Image      from 'next/image';
import WavePlayer from './WavePlayer';

// ── Types ─────────────────────────────────────────────────────────────────────
interface TrackInfo {
  title: string;
  uploader: string;
  duration: number;
  thumbnail: string;
}

interface Settings {
  speed:     number;
  reverb:    number;
  pitch:     number;
  bassBoost: number;
}

type Status = 'idle' | 'loading-info' | 'ready' | 'processing' | 'done' | 'error';

const PRESETS: { label: string; settings: Settings }[] = [
  { label: 'slowed',    settings: { speed: 0.85, reverb: 30, pitch: -1, bassBoost: 3  } },
  { label: 'dreamy',    settings: { speed: 0.78, reverb: 65, pitch: -2, bassBoost: 2  } },
  { label: 'deep',      settings: { speed: 0.70, reverb: 50, pitch: -3, bassBoost: 5  } },
  { label: 'lofi',      settings: { speed: 0.90, reverb: 20, pitch:  0, bassBoost: 4  } },
  { label: 'nightcore', settings: { speed: 1.25, reverb: 10, pitch:  3, bassBoost: 0  } },
];

function fmtDuration(secs: number) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtSpeed(v: number) { return `${v.toFixed(2)}x`; }
function fmtPitch(v: number) { return v === 0 ? '0 semi' : `${v > 0 ? '+' : ''}${v} semi`; }
function fmtReverb(v: number) { return `${v}%`; }
function fmtBass(v: number)   { return v === 0 ? '0 dB' : `+${v} dB`; }

// ── Main component ─────────────────────────────────────────────────────────────
export default function ReverieApp() {
  const [url,          setUrl]          = useState('');
  const [info,         setInfo]         = useState<TrackInfo | null>(null);
  const [settings,     setSettings]     = useState<Settings>({ speed: 1, reverb: 0, pitch: 0, bassBoost: 0 });
  const [status,       setStatus]       = useState<Status>('idle');
  const [error,        setError]        = useState('');
  const [activePreset, setActivePreset] = useState<string | null>(null);
  // Player state
  const [audioBlob,    setAudioBlob]    = useState<{ url: string; name: string } | null>(null);
  const audioBlobRef   = useRef<string | null>(null);

  // ── Load track info ──────────────────────────────────────────────────────────
  const loadInfo = useCallback(async (inputUrl: string) => {
    if (!inputUrl.trim()) return;
    setStatus('loading-info');
    setError('');
    setInfo(null);
    try {
      const res = await fetch(`/api/info?url=${encodeURIComponent(inputUrl.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load track');
      setInfo(data);
      setStatus('ready');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load track');
      setStatus('error');
    }
  }, []);

  // ── Process → load into player ───────────────────────────────────────────────
  const process = useCallback(async () => {
    if (!url.trim() || status === 'processing') return;
    setStatus('processing');
    setError('');
    // Revoke previous blob
    if (audioBlobRef.current) { URL.revokeObjectURL(audioBlobRef.current); audioBlobRef.current = null; }
    setAudioBlob(null);
    try {
      const res = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), ...settings, title: info?.title }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Processing failed');
      }
      const blob        = await res.blob();
      const blobUrl     = URL.createObjectURL(blob);
      const disposition = res.headers.get('content-disposition') || '';
      const match       = disposition.match(/filename="(.+?)"/);
      const name        = match ? match[1] : 'reverie.mp3';
      audioBlobRef.current = blobUrl;
      setAudioBlob({ url: blobUrl, name });
      setStatus('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Processing failed');
      setStatus('error');
    }
  }, [url, settings, info, status]);

  // ── Save to disk (triggered from player) ─────────────────────────────────────
  const saveToDisk = useCallback(() => {
    if (!audioBlob) return;
    const a = document.createElement('a');
    a.href     = audioBlob.url;
    a.download = audioBlob.name;
    a.click();
  }, [audioBlob]);

  const applyPreset = (preset: typeof PRESETS[0]) => {
    setSettings(preset.settings);
    setActivePreset(preset.label);
  };

  const setSetting = (key: keyof Settings, value: number) => {
    setSettings(s => ({ ...s, [key]: value }));
    setActivePreset(null);
  };

  const isReady      = status === 'ready' || status === 'done' || status === 'processing';
  const isProcessing = status === 'processing';
  const isDone       = status === 'done'; // eslint-disable-line @typescript-eslint/no-unused-vars

  const idle = status === 'idle' || status === 'loading-info';

  return (
    <div style={{ ...styles.page, ...(idle ? styles.pageIdle : {}) }}>
      <div style={{ ...styles.card, ...(idle ? styles.cardIdle : {}) }}>

        {/* ── Header ── */}
        <div style={{ ...styles.header, ...(idle ? styles.headerIdle : {}) }}>
          <span style={{ ...styles.wave, ...(idle ? styles.waveIdle : {}) }}>〰️</span>
          <span style={{ ...styles.logo, ...(idle ? styles.logoIdle : {}) }}>reverie</span>
        </div>
        <p style={{ ...styles.tagline, ...(idle ? styles.taglineIdle : {}) }}>
          slowed · reverb · pitch · download
        </p>

        {/* ── Extension badge ── */}
        {idle && (
          <a
            href="https://addons.mozilla.org/en-US/firefox/addon/reverie/"
            target="_blank"
            rel="noreferrer"
            style={styles.extBadge}
          >
            🦊 also available as a firefox extension →
          </a>
        )}

        {/* ── URL Input ── */}
        <div style={{ ...styles.inputRow, ...(idle ? styles.inputRowIdle : {}) }}>
          <input
            style={{ ...styles.input, ...(idle ? styles.inputIdle : {}) }}
            type="text"
            placeholder="paste a youtube or soundcloud link..."
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadInfo(url)}
          />
          <button
            style={{ ...styles.loadBtn, ...(idle ? styles.loadBtnIdle : {}), opacity: status === 'loading-info' ? 0.5 : 1 }}
            onClick={() => loadInfo(url)}
            disabled={status === 'loading-info'}
          >
            {status === 'loading-info' ? '...' : 'load'}
          </button>
        </div>

        {/* ── Track Info ── */}
        {info && (
          <div style={styles.trackCard}>
            {info.thumbnail && (
              <div style={styles.thumb}>
                <Image
                  src={info.thumbnail}
                  alt={info.title}
                  width={64}
                  height={64}
                  style={{ objectFit: 'cover', borderRadius: 6 }}
                  unoptimized
                />
              </div>
            )}
            <div style={styles.trackMeta}>
              <div style={styles.trackTitle}>{info.title}</div>
              <div style={styles.trackSub}>
                {info.uploader}
                {info.duration > 0 && <span style={{ color: 'var(--faint)' }}> · {fmtDuration(info.duration)}</span>}
              </div>
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {status === 'error' && <p style={styles.errorMsg}>{error}</p>}

        {/* ── Presets ── */}
        {isReady && (
          <div>
            <p style={styles.sectionLabel}>presets</p>
            <div style={styles.presets}>
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  style={{
                    ...styles.preset,
                    ...(activePreset === p.label ? styles.presetActive : {}),
                  }}
                  onClick={() => applyPreset(p)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Sliders ── */}
        {isReady && (
          <div style={styles.sliders}>
            <SliderRow label="speed"     value={settings.speed}     fmt={fmtSpeed}  min={0.5}  max={1.5}  step={0.01} onChange={v => setSetting('speed',     v)} />
            <SliderRow label="reverb"    value={settings.reverb}    fmt={fmtReverb} min={0}    max={100}  step={1}    onChange={v => setSetting('reverb',    v)} />
            <SliderRow label="pitch"     value={settings.pitch}     fmt={fmtPitch}  min={-6}   max={6}    step={1}    onChange={v => setSetting('pitch',     v)} />
            <SliderRow label="bass"      value={settings.bassBoost} fmt={fmtBass}   min={0}    max={12}   step={1}    onChange={v => setSetting('bassBoost', v)} />
          </div>
        )}

        {/* ── Process button ── */}
        {isReady && !audioBlob && (
          <button
            style={{ ...styles.dlBtn, ...(isProcessing ? styles.dlBtnLoading : {}) }}
            onClick={process}
            disabled={isProcessing}
          >
            {isProcessing ? 'processing...' : '▶  load &amp; preview'}
          </button>
        )}

        {/* ── Processing note ── */}
        {isProcessing && (
          <p style={styles.processingNote}>
            downloading &amp; processing — this takes 15–30s
          </p>
        )}

        {/* ── Player ── */}
        {audioBlob && (
          <>
            <WavePlayer
              src={audioBlob.url}
              filename={audioBlob.name}
              onDownload={saveToDisk}
            />
            <button
              style={{ ...styles.dlBtn, ...styles.dlBtnOutline }}
              onClick={() => { setAudioBlob(null); setStatus('ready'); }}
            >
              re-process with new settings
            </button>
          </>
        )}

      </div>
    </div>
  );
}

// ── Slider row ─────────────────────────────────────────────────────────────────
function SliderRow({
  label, value, fmt, min, max, step, onChange,
}: {
  label: string; value: number; fmt: (v: number) => string;
  min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <div style={styles.sliderRow}>
      <div style={styles.sliderHeader}>
        <span style={styles.sliderLabel}>{label}</span>
        <span style={styles.sliderValue}>{fmt(value)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '48px 16px 64px',
    background: 'var(--bg)',
  },
  pageIdle: {
    alignItems: 'center',
    padding: '0 16px',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  cardIdle: {
    alignItems: 'center',
    gap: 24,
    paddingBottom: 80,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  headerIdle: {
    gap: 14,
  },
  wave: {
    fontSize: 28,
  },
  waveIdle: {
    fontSize: 52,
  },
  logo: {
    fontSize: 28,
    fontWeight: 600,
    letterSpacing: 6,
    color: '#fff',
  },
  logoIdle: {
    fontSize: 52,
    letterSpacing: 10,
  },
  tagline: {
    fontSize: 11,
    color: 'var(--faint)',
    letterSpacing: 2,
    marginTop: -12,
  },
  taglineIdle: {
    fontSize: 13,
    marginTop: -16,
    letterSpacing: 3,
  },
  extBadge: {
    display: 'inline-block',
    fontSize: 11,
    color: 'var(--muted)',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '5px 14px',
    textDecoration: 'none',
    letterSpacing: 0.5,
    transition: 'border-color 0.15s, color 0.15s',
  },
  inputRowIdle: {
    width: '100%',
    marginTop: 8,
  },
  inputIdle: {
    fontSize: 13,
    padding: '13px 16px',
  },
  loadBtnIdle: {
    fontSize: 13,
    padding: '0 20px',
  },
  inputRow: {
    display: 'flex',
    gap: 8,
  },
  input: {
    flex: 1,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '10px 12px',
    color: '#fff',
    fontSize: 12,
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  loadBtn: {
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--muted)',
    padding: '0 16px',
    fontSize: 12,
    transition: 'all 0.15s',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  trackCard: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: 12,
  },
  thumb: {
    flexShrink: 0,
    width: 64,
    height: 64,
    borderRadius: 6,
    overflow: 'hidden',
    background: 'var(--border)',
  },
  trackMeta: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  trackTitle: {
    color: '#fff',
    fontWeight: 500,
    fontSize: 12,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  trackSub: {
    fontSize: 11,
    color: 'var(--muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 500,
    color: 'var(--faint)',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  presets: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  preset: {
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    color: 'var(--muted)',
    fontSize: 11,
    padding: '6px 12px',
    borderRadius: 8,
    cursor: 'pointer',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap' as const,
  },
  presetActive: {
    background: 'linear-gradient(135deg, #6d28d9, #7c3aed)',
    borderColor: '#8b5cf6',
    color: '#fff',
    boxShadow: '0 0 12px rgba(124, 58, 237, 0.35)',
  },
  sliders: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  sliderRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  sliderHeader: {
    display: 'flex',
    justifyContent: 'space-between',
  },
  sliderLabel: {
    color: 'var(--muted)',
    fontSize: 11,
  },
  sliderValue: {
    color: 'var(--purple-hi)',
    fontSize: 11,
    minWidth: 56,
    textAlign: 'right',
  },
  dlBtn: {
    width: '100%',
    padding: '13px',
    background: 'linear-gradient(135deg, #6d28d9, #7c3aed)',
    border: '1px solid #8b5cf6',
    borderRadius: 10,
    color: '#fff',
    fontSize: 13,
    fontWeight: 500,
    letterSpacing: 1,
    cursor: 'pointer',
    transition: 'all 0.2s',
    boxShadow: '0 0 20px rgba(109, 40, 217, 0.3)',
  },
  dlBtnLoading: {
    opacity: 0.6,
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
  dlBtnDone: {
    background: 'linear-gradient(135deg, #065f46, #10b981)',
    borderColor: '#10b981',
    boxShadow: '0 0 20px rgba(16, 185, 129, 0.25)',
  },
  dlBtnOutline: {
    background: 'transparent',
    border: '1px solid var(--border2)',
    color: 'var(--muted)',
    boxShadow: 'none',
    fontSize: 11,
  },
  processingNote: {
    fontSize: 10,
    color: 'var(--faint)',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  errorMsg: {
    fontSize: 11,
    color: 'var(--red)',
    background: 'rgba(248,113,113,0.06)',
    border: '1px solid rgba(248,113,113,0.2)',
    borderRadius: 8,
    padding: '8px 12px',
  },
};
