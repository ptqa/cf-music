import { type Env, type AuthenticatedRequest } from '../types';
import { subsonicResponse, subsonicError } from '../response';
import { formatSongChild } from './browsing';
import * as queries from '../db/queries';

export async function handleLists(endpoint: string, ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  switch (endpoint) {
    case 'getAlbumList':
    case 'getAlbumList2':
      return handleGetAlbumList(ctx, env, endpoint === 'getAlbumList2');

    case 'getRandomSongs':
      return handleGetRandomSongs(ctx, env);

    case 'getSongsByGenre':
      return handleGetSongsByGenre(ctx, env);

    case 'getNowPlaying':
      return handleGetNowPlaying(ctx, env);

    default:
      return subsonicError(ctx.format, 0, `Unknown list endpoint: ${endpoint}`);
  }
}

async function handleGetAlbumList(ctx: AuthenticatedRequest, env: Env, isId3: boolean): Promise<Response> {
  const type = ctx.params.type;
  if (!type) return subsonicError(ctx.format, 10, 'Missing required parameter: type');

  const size = Math.min(parseInt(ctx.params.size || '10'), 500);
  const offset = parseInt(ctx.params.offset || '0');

  const albums = await queries.getAlbumList2(env.DB, type, size, offset, ctx.params);

  const albumList = albums.map(a => ({
    id: a.id,
    name: a.name,
    artist: a.artist_name,
    artistId: a.artist_id,
    coverArt: a.cover_art_r2_key ? `al-${a.id}` : undefined,
    songCount: a.song_count,
    duration: a.duration,
    year: a.year,
    genre: a.genre,
    created: a.created_at,
    ...(isId3 ? {} : { parent: a.artist_id, isDir: true, title: a.name }),
  }));

  const key = isId3 ? 'albumList2' : 'albumList';
  return subsonicResponse(ctx.format, {
    [key]: {
      album: albumList,
    },
  });
}

async function handleGetRandomSongs(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const size = Math.min(parseInt(ctx.params.size || '10'), 500);
  const genre = ctx.params.genre;
  const fromYear = ctx.params.fromYear ? parseInt(ctx.params.fromYear) : undefined;
  const toYear = ctx.params.toYear ? parseInt(ctx.params.toYear) : undefined;

  const songs = await queries.getRandomSongs(env.DB, size, genre, fromYear, toYear);

  return subsonicResponse(ctx.format, {
    randomSongs: {
      song: songs.map(s => formatSongChild(s)),
    },
  });
}

async function handleGetSongsByGenre(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const genre = ctx.params.genre;
  if (!genre) return subsonicError(ctx.format, 10, 'Missing required parameter: genre');

  const count = Math.min(parseInt(ctx.params.count || '10'), 500);
  const offset = parseInt(ctx.params.offset || '0');

  const songs = await queries.getSongsByGenre(env.DB, genre, count, offset);

  return subsonicResponse(ctx.format, {
    songsByGenre: {
      song: songs.map(s => formatSongChild(s)),
    },
  });
}

async function handleGetNowPlaying(_ctx: AuthenticatedRequest, _env: Env): Promise<Response> {
  // Simple implementation — return empty for now
  // A full implementation would track active streams in a KV or Durable Object
  return subsonicResponse(_ctx.format, {
    nowPlaying: {
      entry: [],
    },
  });
}
