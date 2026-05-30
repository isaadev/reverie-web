import { NextRequest, NextResponse } from 'next/server';

export const runtime     = 'nodejs';
export const maxDuration = 15;

function oEmbedUrl(url: string): string | null {
  if (/youtube\.com|youtu\.be/i.test(url))
    return `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  if (/soundcloud\.com/i.test(url))
    return `https://soundcloud.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  return null;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')?.trim();
  if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 });

  const oembed = oEmbedUrl(url);
  if (!oembed) {
    return NextResponse.json(
      { error: 'Paste a SoundCloud or YouTube link.' },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(oembed, { headers: { 'User-Agent': 'reverie/1.0' } });
    if (!res.ok) throw new Error(`oEmbed error ${res.status}`);
    const data = await res.json() as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };

    return NextResponse.json({
      title:     data.title       ?? 'Unknown',
      uploader:  data.author_name ?? '',
      thumbnail: data.thumbnail_url ?? '',
      duration:  0, // oEmbed doesn't expose duration
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to fetch track info';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
