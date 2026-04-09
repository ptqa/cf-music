import { type Env, type AuthenticatedRequest } from '../types';
import { subsonicResponse, subsonicError } from '../response';
import { formatSongChild } from './browsing';
import * as queries from '../db/queries';

export async function handleSearch(endpoint: string, ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const query = ctx.params.query;
  if (!query) return subsonicError(ctx.format, 10, 'Missing required parameter: query');

  const artistCount = parseInt(ctx.params.artistCount || '20');
  const artistOffset = parseInt(ctx.params.artistOffset || '0');
  const albumCount = parseInt(ctx.params.albumCount || '20');
  const albumOffset = parseInt(ctx.params.albumOffset || '0');
  const songCount = parseInt(ctx.params.songCount || '20');
  const songOffset = parseInt(ctx.params.songOffset || '0');

  const [artists, albums, songs] = await Promise.all([
    queries.searchArtists(env.DB, query, artistCount, artistOffset),
    queries.searchAlbums(env.DB, query, albumCount, albumOffset),
    queries.searchSongs(env.DB, query, songCount, songOffset),
  ]);

  const isId3 = endpoint === 'search3';
  const key = isId3 ? 'searchResult3' : 'searchResult2';

  return subsonicResponse(ctx.format, {
    [key]: {
      artist: artists.map(a => ({
        id: a.id,
        name: a.name,
        coverArt: a.cover_art_r2_key ? `ar-${a.id}` : undefined,
        albumCount: a.album_count,
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
      })),
      song: songs.map(s => formatSongChild(s)),
    },
  });
}
