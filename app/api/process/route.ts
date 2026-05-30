import { NextRequest, NextResponse } from 'next/server';
import { spawn }                     from 'child_process';
import * as fs                       from 'fs';
import * as path                     from 'path';
import * as os                       from 'os';

export const runtime     = 'nodejs';
export const maxDuration = 180;

// ── Audio filter builder ──────────────────────────────────────────────────────

function buildAtempo(speed: number): string[] {
  if (Math.abs(speed - 1.0) < 0.001) return [];
  const filters: string[] = [];
  let r = speed;
  while (r < 0.5) { filters.push('atempo=0.5'); r = r / 0.5; }
  while (r > 2.0) { filters.push('atempo=2.0'); r = r / 2.0; }
  if (Math.abs(r - 1.0) > 0.001) filters.push(`atempo=${r.toFixed(6)}`);
  return filters;
}

function buildFilters(speed: number, reverb: number, pitch: number, bassBoost: number): string {
  const f: string[] = [];
  f.push(...buildAtempo(speed));
  if (Math.abs(pitch) >= 0.5) {
    const factor  = Math.pow(2, pitch / 12);
    f.push(`asetrate=${Math.round(44100 * factor)}`);
    f.push(...buildAtempo(1 / factor));
    f.push('aresample=44100');
  }
  if (bassBoost > 0) f.push(`equalizer=f=80:width_type=o:width=2:g=${bassBoost}`);
  if (reverb   > 0) {
    const m = reverb / 100;
    f.push(`aecho=0.8:0.9:50|100|200|400:${(m*.50).toFixed(3)}|${(m*.38).toFixed(3)}|${(m*.27).toFixed(3)}|${(m*.18).toFixed(3)}`);
  }
  return f.length > 0 ? f.join(',') : 'anull';
}

// ── Cobalt ────────────────────────────────────────────────────────────────────

async function cobaltAudioUrl(trackUrl: string): Promise<string> {
  const res = await fetch('https://api.cobalt.tools/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
      'User-Agent':   'reverie/1.0',
    },
    body: JSON.stringify({ url: trackUrl, downloadMode: 'audio' }),
  });

  const data = await res.json() as {
    status: string;
    url?: string;
    error?: { code?: string };
  };

  if (!res.ok || data.status === 'error') {
    const code = data.error?.code ?? 'unknown';
    throw new Error(`Cobalt error: ${code}`);
  }

  if (!data.url) throw new Error('Cobalt returned no audio URL');
  return data.url;
}

// ── ffmpeg ────────────────────────────────────────────────────────────────────

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    const errChunks: Buffer[] = [];
    proc.stderr.on('data', (d: Buffer) => errChunks.push(d));
    proc.on('close', code => {
      if (code !== 0) {
        const msg = Buffer.concat(errChunks).toString().trim().split('\n').slice(-3).join(' ');
        reject(new Error(`ffmpeg failed: ${msg}`));
      } else resolve();
    });
    proc.on('error', err => reject(new Error(`ffmpeg not found: ${err.message}`)));
  });
}

function sanitize(name: string): string {
  return name.replace(/[^\w\s\-().]/g, '').trim().slice(0, 80) || 'reverie';
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    url, speed = 1.0, reverb = 0, pitch = 0, bassBoost = 0, title = 'reverie',
  } = body as {
    url: string; speed: number; reverb: number;
    pitch: number; bassBoost: number; title?: string;
  };

  if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 });

  const tmpDir     = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-'));
  const outputPath = path.join(tmpDir, 'output.mp3');

  try {
    // 1. Get audio stream URL from cobalt
    const audioUrl = await cobaltAudioUrl(url);

    // 2. ffmpeg: stream from cobalt URL → apply effects → mp3
    const afFilter = buildFilters(
      parseFloat(String(speed)),
      parseFloat(String(reverb)),
      parseFloat(String(pitch)),
      parseFloat(String(bassBoost)),
    );

    await runFfmpeg([
      '-i',        audioUrl,
      '-af',       afFilter,
      '-codec:a',  'libmp3lame',
      '-q:a',      '2',
      '-y',
      outputPath,
    ]);

    // 3. Return processed MP3
    const mp3      = fs.readFileSync(outputPath);
    const filename = `${sanitize(title)}.mp3`;

    return new NextResponse(mp3, {
      status: 200,
      headers: {
        'Content-Type':        'audio/mpeg',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length':      String(mp3.length),
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
