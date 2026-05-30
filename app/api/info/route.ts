import { NextRequest, NextResponse } from 'next/server';
import { spawn }                     from 'child_process';

export const runtime     = 'nodejs';
export const maxDuration = 30;

function ytDlpJson(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    const proc = spawn('yt-dlp', ['--dump-json', '--no-playlist', url]);
    proc.stdout.on('data', (d: Buffer) => chunks.push(d));
    proc.stderr.on('data', (d: Buffer) => errChunks.push(d));

    proc.on('close', code => {
      if (code !== 0) {
        const raw = Buffer.concat(errChunks).toString().trim();
        const msg = raw.split('\n').filter(l => l.startsWith('ERROR')).pop()
          ?? raw.slice(-300) ?? 'yt-dlp failed';
        return reject(new Error(msg));
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString().split('\n')[0]));
      } catch {
        reject(new Error('Failed to parse yt-dlp output'));
      }
    });

    proc.on('error', err => reject(new Error(`yt-dlp not found: ${err.message}`)));
  });
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')?.trim();
  if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 });

  if (!/soundcloud\.com/i.test(url)) {
    return NextResponse.json(
      { error: 'Only SoundCloud links are supported. Paste a soundcloud.com URL.' },
      { status: 400 },
    );
  }

  try {
    const data = await ytDlpJson(url);

    let thumbnail = '';
    if (Array.isArray(data.thumbnails)) {
      const thumbs = (data.thumbnails as Array<{ url: string; width?: number }>).filter(t => t.url);
      thumbnail = (thumbs.find(t => (t.width ?? 9999) <= 640) ?? thumbs.at(-1))?.url ?? '';
    } else if (typeof data.thumbnail === 'string') {
      thumbnail = data.thumbnail as string;
    }

    return NextResponse.json({
      title:    data.title    ?? 'Unknown',
      uploader: data.uploader ?? '',
      duration: data.duration ?? 0,
      thumbnail,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
