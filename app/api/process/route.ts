import { NextRequest, NextResponse } from 'next/server';
import { spawn }                     from 'child_process';

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

// ── Streaming pipeline ────────────────────────────────────────────────────────
// yt-dlp stdout → ffmpeg stdin → ffmpeg stdout → HTTP response
// All three run concurrently — the browser starts receiving audio
// while yt-dlp is still downloading and ffmpeg is still encoding.

function createStream(url: string, afFilter: string): ReadableStream<Uint8Array> {
  const ytdlp = spawn('yt-dlp', [
    '-f', 'bestaudio',
    '--no-playlist',
    '-o', '-',
    url,
  ]);

  const ff = spawn('ffmpeg', [
    '-i', 'pipe:0',
    '-vn',
    ...(afFilter !== 'anull' ? ['-af', afFilter] : []),
    '-codec:a', 'libmp3lame',
    '-q:a', '2',
    '-threads', '0',
    '-f', 'mp3',   // explicit format for stdout output
    'pipe:1',
  ]);

  // yt-dlp → ffmpeg
  ytdlp.stdout.pipe(ff.stdin);
  ytdlp.on('close', code => { if (code !== 0) ff.stdin.destroy(); });

  // Wrap ffmpeg stdout in a Web ReadableStream
  return new ReadableStream<Uint8Array>({
    start(controller) {
      ff.stdout.on('data',  (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      ff.stdout.on('end',   ()              => controller.close());
      ff.stdout.on('error', (err: Error)    => controller.error(err));
      ff.on('close', code => {
        if (code !== 0) controller.error(new Error(`ffmpeg exited ${code}`));
      });
    },
    cancel() {
      ytdlp.kill();
      ff.kill();
    },
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

  const afFilter = buildFilters(+speed, +reverb, +pitch, +bassBoost);
  const stream   = createStream(url, afFilter);

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type':        'audio/mpeg',
      'Content-Disposition': `attachment; filename="${sanitize(title)}.mp3"`,
      'Transfer-Encoding':   'chunked',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
