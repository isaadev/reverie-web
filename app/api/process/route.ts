import { NextRequest, NextResponse } from 'next/server';
import { spawn }                     from 'child_process';
import * as fs                       from 'fs';
import * as path                     from 'path';
import * as os                       from 'os';

export const runtime     = 'nodejs';
export const maxDuration = 180;

// ── Audio filter builder ──────────────────────────────────────────────────────

function buildFilters(speed: number, reverb: number, pitch: number, bassBoost: number): string {
  const f: string[] = [];

  const newRate = Math.round(44100 * speed * Math.pow(2, pitch / 12));
  if (newRate !== 44100) {
    f.push(`asetrate=${newRate}`);
    f.push('aresample=44100');
  }

  if (bassBoost > 0) f.push(`equalizer=f=80:width_type=o:width=2:g=${bassBoost}`);

  if (reverb > 0) {
    const m = reverb / 100;
    f.push(`aecho=0.8:0.9:50|100|200|400:${(m*.50).toFixed(3)}|${(m*.38).toFixed(3)}|${(m*.27).toFixed(3)}|${(m*.18).toFixed(3)}`);
  }

  return f.join(',') || 'anull';
}

function sanitize(name: string): string {
  return name.replace(/[^\w\s\-().]/g, '').trim().slice(0, 80) || 'reverie';
}

// ── yt-dlp → ffmpeg pipeline (runs in parallel) ───────────────────────────────
// yt-dlp streams audio to stdout → ffmpeg reads from stdin → writes output.mp3
// This is ~2x faster than download-then-process since both run simultaneously.

function pipeline(url: string, afFilter: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const fail = (msg: string) => { if (!done) { done = true; reject(new Error(msg)); } };

    // yt-dlp: get best audio, write to stdout
    const ytdlp = spawn('yt-dlp', [
      '-f', 'bestaudio',
      '--no-playlist',
      '-o', '-',   // stdout
      url,
    ]);

    // ffmpeg: read from stdin, apply filters, encode mp3
    const ffArgs = [
      '-i', 'pipe:0',
      '-vn',                        // no video
      ...(afFilter !== 'anull' ? ['-af', afFilter] : []),
      '-codec:a', 'libmp3lame',
      '-q:a', '2',
      '-threads', '0',              // use all cores
      '-y', outputPath,
    ];
    const ff = spawn('ffmpeg', ffArgs);

    // Pipe yt-dlp → ffmpeg
    ytdlp.stdout.pipe(ff.stdin);

    const ytErr: Buffer[] = [];
    const ffErr: Buffer[] = [];
    ytdlp.stderr.on('data', (d: Buffer) => ytErr.push(d));
    ff.stderr.on('data',    (d: Buffer) => ffErr.push(d));

    ytdlp.on('close', code => {
      if (code !== 0) {
        ff.stdin.destroy();
        const raw = Buffer.concat(ytErr).toString().trim();
        const msg = raw.split('\n').filter(l => l.startsWith('ERROR')).pop()
          ?? raw.split('\n').slice(-3).join(' ');
        fail(msg || 'yt-dlp failed');
      }
    });

    ff.on('close', code => {
      if (code !== 0) {
        const msg = Buffer.concat(ffErr).toString().trim().split('\n').slice(-3).join(' ');
        fail(`ffmpeg failed: ${msg}`);
      } else {
        if (!done) { done = true; resolve(); }
      }
    });

    ytdlp.on('error', err => fail(`yt-dlp: ${err.message}`));
    ff.on('error',    err => fail(`ffmpeg: ${err.message}`));
  });
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

  if (!/soundcloud\.com/i.test(url)) {
    return NextResponse.json({ error: 'Only SoundCloud links are supported.' }, { status: 400 });
  }

  const tmpDir     = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-'));
  const outputPath = path.join(tmpDir, 'output.mp3');

  try {
    const afFilter = buildFilters(+speed, +reverb, +pitch, +bassBoost);
    await pipeline(url, afFilter, outputPath);

    const mp3 = fs.readFileSync(outputPath);
    return new NextResponse(mp3, {
      status: 200,
      headers: {
        'Content-Type':        'audio/mpeg',
        'Content-Disposition': `attachment; filename="${sanitize(title)}.mp3"`,
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
