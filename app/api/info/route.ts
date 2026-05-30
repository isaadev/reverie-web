import { NextRequest, NextResponse } from 'next/server';
import { spawn }                     from 'child_process';
import * as fs                       from 'fs';
import * as path                     from 'path';
import * as os                       from 'os';

export const runtime    = 'nodejs';
export const maxDuration = 30;

function cookiesArgs(): string[] {
  const b64 = process.env.YOUTUBE_COOKIES;
  if (!b64) return [];
  const cookiesPath = path.join(os.tmpdir(), `yt-cookies-${Date.now()}.txt`);
  fs.writeFileSync(cookiesPath, Buffer.from(b64, 'base64').toString('utf-8'));
  return ['--cookies', cookiesPath];
}

function ytDlpJson(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    const proc = spawn('yt-dlp', [
      '--dump-json',
      '--no-playlist',
      '--extractor-args', 'youtube:player_client=android,ios,web',
      ...cookiesArgs(),
      url,
    ]);

    proc.stdout.on('data', (d: Buffer) => chunks.push(d));
    proc.stderr.on('data', (d: Buffer) => errChunks.push(d));

    proc.on('close', code => {
      if (code !== 0) {
        const raw = Buffer.concat(errChunks).toString().trim();
        const msg = raw.includes('Sign in') || raw.includes('429')
          ? 'YouTube is rate-limiting this server. Try a SoundCloud link, or try again in a few minutes.'
          : raw.split('\n').filter(l => l.startsWith('ERROR')).pop() ?? raw.slice(-300);
        return reject(new Error(msg || 'yt-dlp failed'));
      }
      try {
        // yt-dlp may emit multiple JSON lines for playlists — take the first
        const firstLine = Buffer.concat(chunks).toString().split('\n')[0];
        resolve(JSON.parse(firstLine));
      } catch {
        reject(new Error('Failed to parse yt-dlp output'));
      }
    });

    proc.on('error', err => reject(new Error(`yt-dlp not found: ${err.message}`)));
  });
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 });

  try {
    const data = await ytDlpJson(url);

    // Pick the best thumbnail (prefer ≤640px wide)
    let thumbnail = '';
    if (Array.isArray(data.thumbnails)) {
      const thumbs = (data.thumbnails as Array<{ url: string; width?: number }>)
        .filter(t => t.url);
      const mid = thumbs.find(t => (t.width ?? 9999) <= 640);
      thumbnail = (mid ?? thumbs[thumbs.length - 1])?.url ?? '';
    } else if (typeof data.thumbnail === 'string') {
      thumbnail = data.thumbnail as string;
    }

    return NextResponse.json({
      title:    data.title    ?? 'Unknown',
      uploader: data.uploader ?? data.channel ?? '',
      duration: data.duration ?? 0,
      thumbnail,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
