import { type Env, type AuthenticatedRequest } from '../types';
import { subsonicResponse, subsonicError } from '../response';
import { formatSongChild } from './browsing';
import * as queries from '../db/queries';

export async function handleAnnotation(endpoint: string, ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  switch (endpoint) {
    case 'star':
      return handleStar(ctx, env);
    case 'unstar':
      return handleUnstar(ctx, env);
    case 'getStarred':
    case 'getStarred2':
      return handleGetStarred(ctx, env, endpoint === 'getStarred2');
    case 'setRating':
      return handleSetRating(ctx, env);
    case 'scrobble':
      return handleScrobble(ctx, env);
    default:
      return subsonicError(ctx.format, 0, `Unknown annotation endpoint: ${endpoint}`);
  }
}

async function handleStar(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const { id, albumId, artistId } = ctx.params;
  const userId = ctx.user.id;

  if (id) await queries.star(env.DB, userId, id, 'song');
  if (albumId) await queries.star(env.DB, userId, albumId, 'album');
  if (artistId) await queries.star(env.DB, userId, artistId, 'artist');

  return subsonicResponse(ctx.format);
}

async function handleUnstar(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const { id, albumId, artistId } = ctx.params;
  const userId = ctx.user.id;

  if (id) await queries.unstar(env.DB, userId, id, 'song');
  if (albumId) await queries.unstar(env.DB, userId, albumId, 'album');
  if (artistId) await queries.unstar(env.DB, userId, artistId, 'artist');

  return subsonicResponse(ctx.format);
}

async function handleGetStarred(ctx: AuthenticatedRequest, env: Env, isId3: boolean): Promise<Response> {
  const userId = ctx.user.id;

  const [artists, albums, songs] = await Promise.all([
    queries.getStarredArtists(env.DB, userId),
    queries.getStarredAlbums(env.DB, userId),
    queries.getStarredSongs(env.DB, userId),
  ]);

  const key = isId3 ? 'starred2' : 'starred';

  return subsonicResponse(ctx.format, {
    [key]: {
      artist: artists.map(a => ({
        id: a.id,
        name: a.name,
        coverArt: a.cover_art_r2_key ? `ar-${a.id}` : undefined,
        albumCount: a.album_count,
        starred: a.starred_at,
      })),
      album: albums.map(a => ({
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
        starred: a.starred_at,
      })),
      song: songs.map(s => ({
        ...formatSongChild(s),
        starred: s.starred_at,
      })),
    },
  });
}

async function handleSetRating(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const id = ctx.params.id;
  const rating = parseInt(ctx.params.rating || '0');

  if (!id) return subsonicError(ctx.format, 10, 'Missing required parameter: id');
  if (rating < 0 || rating > 5) return subsonicError(ctx.format, 10, 'Rating must be between 0 and 5');

  // Determine type by trying to find the item
  const song = await queries.getSong(env.DB, id);
  if (song) {
    await queries.setRating(env.DB, ctx.user.id, id, 'song', rating);
  } else {
    const album = await queries.getAlbum(env.DB, id);
    if (album) {
      await queries.setRating(env.DB, ctx.user.id, id, 'album', rating);
    } else {
      await queries.setRating(env.DB, ctx.user.id, id, 'artist', rating);
    }
  }

  return subsonicResponse(ctx.format);
}

async function handleScrobble(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const id = ctx.params.id;
  if (!id) return subsonicError(ctx.format, 10, 'Missing required parameter: id');

  await queries.scrobble(env.DB, ctx.user.id, id);

  return subsonicResponse(ctx.format);
}
