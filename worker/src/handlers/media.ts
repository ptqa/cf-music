import { type Env, type AuthenticatedRequest } from '../types';
import { subsonicError } from '../response';
import * as queries from '../db/queries';

export async function handleMedia(endpoint: string, ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  switch (endpoint) {
    case 'stream':
    case 'download':
      return handleStream(ctx, env);

    case 'getCoverArt':
      return handleGetCoverArt(ctx, env);

    default:
      return subsonicError(ctx.format, 0, `Unknown media endpoint: ${endpoint}`);
  }
}

async function handleStream(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const id = ctx.params.id;
  if (!id) return subsonicError(ctx.format, 10, 'Missing required parameter: id');

  const song = await queries.getSong(env.DB, id);
  if (!song) return subsonicError(ctx.format, 70, 'Song not found');

  const rangeHeader = ctx.request.headers.get('Range');

  if (rangeHeader && song.file_size) {
    const { start, end } = parseRange(rangeHeader, song.file_size);
    const object = await env.BUCKET.get(song.r2_key, {
      range: { offset: start, length: end - start + 1 },
    });

    if (!object) return subsonicError(ctx.format, 70, 'File not found in storage');

    return new Response(object.body, {
      status: 206,
      headers: {
        'Content-Type': song.content_type,
        'Content-Range': `bytes ${start}-${end}/${song.file_size}`,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  const object = await env.BUCKET.get(song.r2_key);
  if (!object) return subsonicError(ctx.format, 70, 'File not found in storage');

  return new Response(object.body, {
    headers: {
      'Content-Type': song.content_type,
      'Content-Length': String(song.file_size || object.size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

async function handleGetCoverArt(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const id = ctx.params.id;
  if (!id) return subsonicError(ctx.format, 10, 'Missing required parameter: id');

  let r2Key: string | null = null;

  if (id.startsWith('al-')) {
    const albumId = id.slice(3);
    const album = await queries.getAlbum(env.DB, albumId);
    r2Key = album?.cover_art_r2_key ?? null;
  } else if (id.startsWith('ar-')) {
    const artistId = id.slice(3);
    const artist = await queries.getArtist(env.DB, artistId);
    r2Key = artist?.cover_art_r2_key ?? null;
  } else {
    // Song cover art — use the album's cover
    const song = await queries.getSong(env.DB, id);
    if (song) {
      const album = await queries.getAlbum(env.DB, song.album_id);
      r2Key = album?.cover_art_r2_key ?? null;
    }
  }

  if (!r2Key) {
    return subsonicError(ctx.format, 70, 'Cover art not found');
  }

  const object = await env.BUCKET.get(r2Key);
  if (!object) return new Response('Not Found', { status: 404 });

  // Determine content type from key
  const contentType = r2Key.endsWith('.png') ? 'image/png' : 'image/jpeg';

  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(object.size),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

function parseRange(rangeHeader: string, fileSize: number): { start: number; end: number } {
  const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (!match) return { start: 0, end: fileSize - 1 };

  let start = match[1] ? parseInt(match[1]) : 0;
  let end = match[2] ? parseInt(match[2]) : fileSize - 1;

  // Handle suffix range (e.g., "bytes=-500")
  if (!match[1] && match[2]) {
    start = fileSize - parseInt(match[2]);
    end = fileSize - 1;
  }

  // Clamp
  start = Math.max(0, start);
  end = Math.min(end, fileSize - 1);

  return { start, end };
}
