import { NextRequest, NextResponse } from 'next/server';
import { spawn }                     from 'child_process';
import * as fs                       from 'fs';
import * as path                     from 'path';
import * as os                       from 'os';

export const runtime     = 'nodejs';
export const maxDuration = 180; // Railway hobby allows up to 300s

// ── Audio filter builder ──────────────────────────────────────────────────────

/** Build a chain of atempo filters for speeds outside the 0.5–2.0 range */
function buildAtempo(speed: number): string[] {
  if (Math.abs(speed - 1.0) < 0.001) return [];
  const filters: string[] = [];
  let remaining = speed;
  while (remaining < 0.5)  { filters.push('atempo=0.5'); remaining = remaining / 0.5; }
  while (remaining > 2.0)  { filters.push('atempo=2.0'); remaining = remaining / 2.0; }
  if (Math.abs(remaining - 1.0) > 0.001) filters.push(`atempo=${remaining.toFixed(6)}`);
  return filters;
}

function buildFilters(speed: number, reverb: number, pitch: number, bassBoost: number): string {
  const filters: string[] = [];

  // 1. Speed via atempo (preserves pitch)
  filters.push(...buildAtempo(speed));

  // 2. Pitch shift independent of speed:
  //    asetrate shifts pitch+speed together → atempo correction brings speed back
  if (Math.abs(pitch) >= 0.5) {
    const SR          = 44100;
    const pitchFactor = Math.pow(2, pitch / 12);
    const newRate     = Math.round(SR * pitchFactor);
    filters.push(`asetrate=${newRate}`);
    // Correct speed: if we sped up via asetrate, slow back down (and vice-versa)
    filters.push(...buildAtempo(1 / pitchFactor));
    // Resample back to 44100 so downstream filters work correctly
    filters.push('aresample=44100');
  }

  // 3. Bass boost
  if (bassBoost > 0) {
    filters.push(`equalizer=f=80:width_type=o:width=2:g=${bassBoost}`);
  }

  // 4. Reverb via aecho (multi-tap, scaled by reverb%)
  if (reverb > 0) {
    const mix = reverb / 100;
    const d1  = (mix * 0.50).toFixed(3);
    const d2  = (mix * 0.38).toFixed(3);
    const d3  = (mix * 0.27).toFixed(3);
    const d4  = (mix * 0.18).toFixed(3);
    filters.push(`aecho=0.8:0.9:50|100|200|400:${d1}|${d2}|${d3}|${d4}`);
  }

  return filters.length > 0 ? filters.join(',') : 'anull';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    const errChunks: Buffer[] = [];
    proc.stderr.on('data', (d: Buffer) => errChunks.push(d));
    proc.on('close', code => {
      if (code !== 0) {
        const msg = Buffer.concat(errChunks).toString().trim().split('\n').slice(-3).join(' ');
        reject(new Error(`${cmd} exited ${code}: ${msg}`));
      } else {
        resolve();
      }
    });
    proc.on('error', err => reject(new Error(`${cmd} not found: ${err.message}`)));
  });
}

function sanitize(name: string): string {
  return name.replace(/[^\w\s\-().]/g, '').trim().slice(0, 80) || 'reverie';
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    url,
    speed     = 1.0,
    reverb    = 0,
    pitch     = 0,
    bassBoost = 0,
    title     = 'reverie',
  } = body as {
    url: string; speed: number; reverb: number;
    pitch: number; bassBoost: number; title?: string;
  };

  if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-'));

  try {
    // ── 1. Download best audio with yt-dlp ──────────────────────────────────
    await run('yt-dlp', [
      '-x',
      '--audio-format', 'wav',
      '--audio-quality', '0',
      '--no-playlist',
      '-o', path.join(tmpDir, 'input.%(ext)s'),
      url,
    ]);

    const files      = fs.readdirSync(tmpDir);
    const inputFile  = files.find(f => f.startsWith('input.'));
    if (!inputFile) throw new Error('Download produced no file');
    const inputPath  = path.join(tmpDir, inputFile);
    const outputPath = path.join(tmpDir, 'output.mp3');

    // ── 2. Process with ffmpeg ───────────────────────────────────────────────
    const afFilter = buildFilters(
      parseFloat(String(speed)),
      parseFloat(String(reverb)),
      parseFloat(String(pitch)),
      parseFloat(String(bassBoost)),
    );

    await run('ffmpeg', [
      '-i', inputPath,
      '-af', afFilter,
      '-codec:a', 'libmp3lame',
      '-q:a', '2',        // ~190 kbps VBR
      '-y',
      outputPath,
    ]);

    // ── 3. Stream back ───────────────────────────────────────────────────────
    const mp3 = fs.readFileSync(outputPath);
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
