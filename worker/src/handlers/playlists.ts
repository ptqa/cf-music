import { type Env, type AuthenticatedRequest } from '../types';
import { subsonicResponse, subsonicError, toISO } from '../response';
import { formatSongChild } from './browsing';
import * as queries from '../db/queries';

export async function handlePlaylists(endpoint: string, ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  switch (endpoint) {
    case 'getPlaylists':
      return handleGetPlaylists(ctx, env);
    case 'getPlaylist':
      return handleGetPlaylist(ctx, env);
    case 'createPlaylist':
      return handleCreatePlaylist(ctx, env);
    case 'updatePlaylist':
      return handleUpdatePlaylist(ctx, env);
    case 'deletePlaylist':
      return handleDeletePlaylist(ctx, env);
    default:
      return subsonicError(ctx.format, 0, `Unknown playlist endpoint: ${endpoint}`);
  }
}

async function handleGetPlaylists(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const playlists = await queries.getPlaylists(env.DB, ctx.user.id);

  return subsonicResponse(ctx.format, {
    playlists: {
      playlist: playlists.map(p => formatPlaylist(p, ctx.user.username)),
    },
  });
}

async function handleGetPlaylist(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const id = ctx.params.id;
  if (!id) return subsonicError(ctx.format, 10, 'Missing required parameter: id');

  const playlist = await queries.getPlaylist(env.DB, id);
  if (!playlist) return subsonicError(ctx.format, 70, 'Playlist not found');

  const songs = await queries.getPlaylistSongs(env.DB, id);

  return subsonicResponse(ctx.format, {
    playlist: {
      ...formatPlaylist(playlist, ctx.user.username),
      entry: songs.map(s => formatSongChild(s)),
    },
  });
}

async function handleCreatePlaylist(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const name = ctx.params.name;
  const playlistId = ctx.params.playlistId; // If set, update existing

  if (playlistId) {
    // Update existing playlist
    const songId = ctx.params.songId;
    const songIds = songId ? [songId] : [];
    if (name) {
      await queries.updatePlaylist(env.DB, playlistId, name);
    }
    if (songIds.length > 0) {
      await queries.updatePlaylist(env.DB, playlistId, undefined, undefined, undefined, songIds);
    }
    const playlist = await queries.getPlaylist(env.DB, playlistId);
    const songs = await queries.getPlaylistSongs(env.DB, playlistId);
    return subsonicResponse(ctx.format, {
      playlist: {
        ...formatPlaylist(playlist!, ctx.user.username),
        entry: songs.map(s => formatSongChild(s)),
      },
    });
  }

  if (!name) return subsonicError(ctx.format, 10, 'Missing required parameter: name');

  const id = crypto.randomUUID();
  const songId = ctx.params.songId;
  const songIds = songId ? [songId] : [];

  await queries.createPlaylist(env.DB, id, name, ctx.user.id, songIds);

  const playlist = await queries.getPlaylist(env.DB, id);
  const songs = await queries.getPlaylistSongs(env.DB, id);

  return subsonicResponse(ctx.format, {
    playlist: {
      ...formatPlaylist(playlist!, ctx.user.username),
      entry: songs.map(s => formatSongChild(s)),
    },
  });
}

async function handleUpdatePlaylist(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const playlistId = ctx.params.playlistId;
  if (!playlistId) return subsonicError(ctx.format, 10, 'Missing required parameter: playlistId');

  const playlist = await queries.getPlaylist(env.DB, playlistId);
  if (!playlist) return subsonicError(ctx.format, 70, 'Playlist not found');
  if (playlist.user_id !== ctx.user.id) return subsonicError(ctx.format, 50, 'Permission denied');

  const name = ctx.params.name;
  const comment = ctx.params.comment;
  const isPublic = ctx.params.public !== undefined ? ctx.params.public === 'true' : undefined;
  const songIdToAdd = ctx.params.songIdToAdd;
  const songIndexToRemove = ctx.params.songIndexToRemove;

  await queries.updatePlaylist(
    env.DB,
    playlistId,
    name,
    comment,
    isPublic,
    songIdToAdd ? [songIdToAdd] : undefined,
    songIndexToRemove !== undefined ? [parseInt(songIndexToRemove)] : undefined,
  );

  return subsonicResponse(ctx.format);
}

async function handleDeletePlaylist(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const id = ctx.params.id;
  if (!id) return subsonicError(ctx.format, 10, 'Missing required parameter: id');

  const playlist = await queries.getPlaylist(env.DB, id);
  if (!playlist) return subsonicError(ctx.format, 70, 'Playlist not found');
  if (playlist.user_id !== ctx.user.id && ctx.user.is_admin !== 1) {
    return subsonicError(ctx.format, 50, 'Permission denied');
  }

  await queries.deletePlaylist(env.DB, id);

  return subsonicResponse(ctx.format);
}

function formatPlaylist(p: { id: string; name: string; user_id: string; comment: string | null; is_public: number; song_count: number; duration: number; created_at: string; updated_at: string }, username: string) {
  return {
    id: p.id,
    name: p.name,
    songCount: p.song_count,
    duration: p.duration,
    public: p.is_public === 1,
    owner: username,
    created: toISO(p.created_at),
    changed: toISO(p.updated_at),
    comment: p.comment,
  };
}
