import { type Env, type AuthenticatedRequest } from '../types';
import { subsonicResponse, subsonicError } from '../response';
import { formatSongChild } from './browsing';
import * as queries from '../db/queries';

export async function handleBookmarks(endpoint: string, ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  switch (endpoint) {
    case 'savePlayQueue':
      return handleSavePlayQueue(ctx, env);
    case 'getPlayQueue':
      return handleGetPlayQueue(ctx, env);
    default:
      return subsonicError(ctx.format, 0, `Unknown bookmark endpoint: ${endpoint}`);
  }
}

async function handleSavePlayQueue(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const id = ctx.params.id; // current song
  const current = ctx.params.current || id;
  const position = parseInt(ctx.params.position || '0');

  if (!current) return subsonicError(ctx.format, 10, 'Missing required parameter: id or current');

  // Collect all song IDs from the queue
  // The Subsonic API sends multiple `id` params; since we only get the last one from our param parsing,
  // we'll use the current song as the queue for now.
  // TODO: Parse multiple `id` params from the URL
  const songIds = [current];

  await queries.savePlayQueue(env.DB, ctx.user.id, current, position, songIds, ctx.params.c || 'unknown');

  return subsonicResponse(ctx.format);
}

async function handleGetPlayQueue(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const queue = await queries.getPlayQueue(env.DB, ctx.user.id);
  if (!queue) {
    return subsonicResponse(ctx.format, {
      playQueue: {},
    });
  }

  const songIds: string[] = JSON.parse(queue.song_ids);
  const songs = [];
  for (const songId of songIds) {
    const song = await queries.getSong(env.DB, songId);
    if (song) songs.push(song);
  }

  return subsonicResponse(ctx.format, {
    playQueue: {
      entry: songs.map(s => formatSongChild(s)),
      current: queue.current_song_id,
      position: queue.position,
      username: ctx.user.username,
      changed: queue.changed_at,
      changedBy: queue.changed_by,
    },
  });
}
