import { type Env, type AuthenticatedRequest, type ArtistRow, type SongRow } from '../types';
import { subsonicResponse, subsonicError } from '../response';
import * as queries from '../db/queries';

export async function handleBrowsing(endpoint: string, ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  switch (endpoint) {
    case 'getMusicFolders':
      return subsonicResponse(ctx.format, {
        musicFolders: {
          musicFolder: [{ id: 0, name: 'Music' }],
        },
      });

    case 'getIndexes':
      return handleGetIndexes(ctx, env);

    case 'getMusicDirectory':
      return handleGetMusicDirectory(ctx, env);

    case 'getArtists':
      return handleGetArtists(ctx, env);

    case 'getArtist':
      return handleGetArtist(ctx, env);

    case 'getAlbum':
      return handleGetAlbum(ctx, env);

    case 'getSong':
      return handleGetSong(ctx, env);

    case 'getGenres':
      return handleGetGenres(ctx, env);

    default:
      return subsonicError(ctx.format, 0, `Unknown browsing endpoint: ${endpoint}`);
  }
}

// Build alphabetical index from artists
async function handleGetIndexes(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const artists = await queries.getArtists(env.DB);
  const indexMap = buildArtistIndex(artists);

  return subsonicResponse(ctx.format, {
    indexes: {
      lastModified: Date.now(),
      ignoredArticles: 'The El La Los Las Le Les',
      index: Object.entries(indexMap).map(([letter, arts]) => ({
        name: letter,
        artist: arts.map(a => formatArtistForIndex(a)),
      })),
    },
  });
}

async function handleGetMusicDirectory(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const id = ctx.params.id;
  if (!id) return subsonicError(ctx.format, 10, 'Missing required parameter: id');

  // Try as artist ID first
  const artist = await queries.getArtist(env.DB, id);
  if (artist) {
    const albums = await queries.getAlbumsByArtist(env.DB, id);
    return subsonicResponse(ctx.format, {
      directory: {
        id: artist.id,
        name: artist.name,
        child: albums.map(a => ({
          id: a.id,
          parent: artist.id,
          isDir: true,
          title: a.name,
          artist: a.artist_name,
          coverArt: a.cover_art_r2_key ? `al-${a.id}` : undefined,
          year: a.year,
          genre: a.genre,
        })),
      },
    });
  }

  // Try as album ID
  const album = await queries.getAlbum(env.DB, id);
  if (album) {
    const songs = await queries.getSongsByAlbum(env.DB, id);
    return subsonicResponse(ctx.format, {
      directory: {
        id: album.id,
        parent: album.artist_id,
        name: album.name,
        artist: album.artist_name,
        coverArt: album.cover_art_r2_key ? `al-${album.id}` : undefined,
        year: album.year,
        genre: album.genre,
        child: songs.map(s => formatSongChild(s)),
      },
    });
  }

  return subsonicError(ctx.format, 70, 'Directory not found');
}

async function handleGetArtists(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const artists = await queries.getArtists(env.DB);
  const indexMap = buildArtistIndex(artists);

  return subsonicResponse(ctx.format, {
    artists: {
      ignoredArticles: 'The El La Los Las Le Les',
      index: Object.entries(indexMap).map(([letter, arts]) => ({
        name: letter,
        artist: arts.map(a => ({
          id: a.id,
          name: a.name,
          coverArt: a.cover_art_r2_key ? `ar-${a.id}` : undefined,
          albumCount: a.album_count,
          artistImageUrl: a.cover_art_r2_key ? `ar-${a.id}` : undefined,
        })),
      })),
    },
  });
}

async function handleGetArtist(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const id = ctx.params.id;
  if (!id) return subsonicError(ctx.format, 10, 'Missing required parameter: id');

  const artist = await queries.getArtist(env.DB, id);
  if (!artist) return subsonicError(ctx.format, 70, 'Artist not found');

  const albums = await queries.getAlbumsByArtist(env.DB, id);

  return subsonicResponse(ctx.format, {
    artist: {
      id: artist.id,
      name: artist.name,
      coverArt: artist.cover_art_r2_key ? `ar-${artist.id}` : undefined,
      albumCount: artist.album_count,
      album: albums.map(a => formatAlbum(a)),
    },
  });
}

async function handleGetAlbum(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const id = ctx.params.id;
  if (!id) return subsonicError(ctx.format, 10, 'Missing required parameter: id');

  const album = await queries.getAlbum(env.DB, id);
  if (!album) return subsonicError(ctx.format, 70, 'Album not found');

  const songs = await queries.getSongsByAlbum(env.DB, id);

  return subsonicResponse(ctx.format, {
    album: {
      id: album.id,
      name: album.name,
      artist: album.artist_name,
      artistId: album.artist_id,
      coverArt: album.cover_art_r2_key ? `al-${album.id}` : undefined,
      songCount: album.song_count,
      duration: album.duration,
      year: album.year,
      genre: album.genre,
      created: album.created_at,
      song: songs.map(s => formatSongChild(s)),
    },
  });
}

async function handleGetSong(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const id = ctx.params.id;
  if (!id) return subsonicError(ctx.format, 10, 'Missing required parameter: id');

  const song = await queries.getSong(env.DB, id);
  if (!song) return subsonicError(ctx.format, 70, 'Song not found');

  return subsonicResponse(ctx.format, {
    song: formatSongChild(song),
  });
}

async function handleGetGenres(ctx: AuthenticatedRequest, env: Env): Promise<Response> {
  const genres = await queries.getGenres(env.DB);
  return subsonicResponse(ctx.format, {
    genres: {
      genre: genres.map(g => ({
        songCount: g.song_count,
        albumCount: g.album_count,
        value: g.name,
      })),
    },
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildArtistIndex(artists: ArtistRow[]): Record<string, ArtistRow[]> {
  const ignoredArticles = ['the', 'el', 'la', 'los', 'las', 'le', 'les'];
  const indexMap: Record<string, ArtistRow[]> = {};

  for (const artist of artists) {
    let sortName = (artist.sort_name || artist.name).trim();
    // Strip leading articles for index letter
    const lower = sortName.toLowerCase();
    for (const article of ignoredArticles) {
      if (lower.startsWith(article + ' ')) {
        sortName = sortName.slice(article.length + 1);
        break;
      }
    }
    const letter = sortName.charAt(0).toUpperCase();
    const key = /[A-Z]/.test(letter) ? letter : '#';
    if (!indexMap[key]) indexMap[key] = [];
    indexMap[key].push(artist);
  }

  // Sort keys alphabetically, with # at the end
  const sorted: Record<string, ArtistRow[]> = {};
  const keys = Object.keys(indexMap).sort((a, b) => {
    if (a === '#') return 1;
    if (b === '#') return -1;
    return a.localeCompare(b);
  });
  for (const key of keys) {
    sorted[key] = indexMap[key];
  }
  return sorted;
}

function formatArtistForIndex(a: ArtistRow) {
  return {
    id: a.id,
    name: a.name,
    albumCount: a.album_count,
    coverArt: a.cover_art_r2_key ? `ar-${a.id}` : undefined,
  };
}

function formatAlbum(a: { id: string; name: string; artist_name: string; artist_id: string; cover_art_r2_key: string | null; song_count: number; duration: number; year: number | null; genre: string | null; created_at: string }) {
  return {
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
  };
}

export function formatSongChild(s: SongRow) {
  return {
    id: s.id,
    parent: s.album_id,
    isDir: false,
    title: s.title,
    album: s.album_name,
    artist: s.artist_name,
    track: s.track_number,
    year: s.year,
    genre: s.genre,
    coverArt: s.cover_art_r2_key ? `al-${s.album_id}` : (s.album_id ? `al-${s.album_id}` : undefined),
    size: s.file_size,
    contentType: s.content_type,
    suffix: s.suffix,
    duration: s.duration,
    bitRate: s.bit_rate,
    bitDepth: s.bit_depth,
    samplingRate: s.sampling_rate,
    channelCount: s.channel_count,
    path: s.path,
    albumId: s.album_id,
    artistId: s.artist_id,
    type: 'music',
    isVideo: false,
    discNumber: s.disc_number,
    created: s.created_at,
  };
}
