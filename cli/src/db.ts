/**
 * D1 REST API client.
 * Uses Cloudflare API to execute SQL against D1.
 */

import { type Config } from './config';

interface D1Result {
  results: Record<string, unknown>[];
  success: boolean;
  meta: Record<string, unknown>;
}

interface D1Response {
  result: D1Result[];
  success: boolean;
  errors: { code: number; message: string }[];
}

export class D1Client {
  private accountId: string;
  private databaseId: string;
  private apiToken: string;

  constructor(config: Config) {
    this.accountId = config.cloudflare.account_id;
    this.databaseId = config.d1.database_id;
    this.apiToken = config.cloudflare.api_token;
  }

  async execute(sql: string, params: unknown[] = []): Promise<D1Result> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`D1 API error (${response.status}): ${text}`);
    }

    const data = await response.json() as D1Response;
    if (!data.success) {
      throw new Error(`D1 query failed: ${data.errors.map(e => e.message).join(', ')}`);
    }

    return data.result[0];
  }

  async batch(statements: { sql: string; params: unknown[] }[]): Promise<D1Result[]> {
    // D1 REST API doesn't have a native batch endpoint, so we execute sequentially
    // For better performance, we could use a transaction wrapper
    const results: D1Result[] = [];
    for (const stmt of statements) {
      results.push(await this.execute(stmt.sql, stmt.params));
    }
    return results;
  }

  // ─── Upsert helpers ─────────────────────────────────────────────────

  async upsertArtist(artist: {
    id: string;
    name: string;
    sort_name: string | null;
    cover_art_r2_key: string | null;
    musicbrainz_id: string | null;
  }): Promise<void> {
    await this.execute(
      `INSERT INTO artists (id, name, sort_name, cover_art_r2_key, musicbrainz_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         sort_name = excluded.sort_name,
         cover_art_r2_key = COALESCE(excluded.cover_art_r2_key, artists.cover_art_r2_key),
         musicbrainz_id = COALESCE(excluded.musicbrainz_id, artists.musicbrainz_id),
         updated_at = datetime('now')`,
      [artist.id, artist.name, artist.sort_name, artist.cover_art_r2_key, artist.musicbrainz_id]
    );
  }

  async upsertAlbum(album: {
    id: string;
    name: string;
    artist_id: string;
    artist_name: string;
    cover_art_r2_key: string | null;
    year: number | null;
    genre: string | null;
  }): Promise<void> {
    await this.execute(
      `INSERT INTO albums (id, name, artist_id, artist_name, cover_art_r2_key, year, genre)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         artist_id = excluded.artist_id,
         artist_name = excluded.artist_name,
         cover_art_r2_key = COALESCE(excluded.cover_art_r2_key, albums.cover_art_r2_key),
         year = COALESCE(excluded.year, albums.year),
         genre = COALESCE(excluded.genre, albums.genre),
         updated_at = datetime('now')`,
      [album.id, album.name, album.artist_id, album.artist_name, album.cover_art_r2_key, album.year, album.genre]
    );
  }

  async upsertSong(song: {
    id: string;
    title: string;
    album_id: string;
    artist_id: string;
    album_name: string;
    artist_name: string;
    track_number: number | null;
    disc_number: number | null;
    year: number | null;
    genre: string | null;
    duration: number | null;
    bit_rate: number | null;
    bit_depth: number | null;
    sampling_rate: number | null;
    channel_count: number | null;
    file_size: number;
    content_type: string;
    suffix: string;
    r2_key: string;
    cover_art_r2_key: string | null;
    path: string;
  }): Promise<void> {
    await this.execute(
      `INSERT INTO songs (id, title, album_id, artist_id, album_name, artist_name,
        track_number, disc_number, year, genre, duration, bit_rate, bit_depth,
        sampling_rate, channel_count, file_size, content_type, suffix, r2_key,
        cover_art_r2_key, path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         album_id = excluded.album_id,
         artist_id = excluded.artist_id,
         album_name = excluded.album_name,
         artist_name = excluded.artist_name,
         track_number = excluded.track_number,
         disc_number = excluded.disc_number,
         year = excluded.year,
         genre = excluded.genre,
         duration = excluded.duration,
         bit_rate = excluded.bit_rate,
         bit_depth = excluded.bit_depth,
         sampling_rate = excluded.sampling_rate,
         channel_count = excluded.channel_count,
         file_size = excluded.file_size,
         content_type = excluded.content_type,
         suffix = excluded.suffix,
         r2_key = excluded.r2_key,
         cover_art_r2_key = COALESCE(excluded.cover_art_r2_key, songs.cover_art_r2_key),
         path = excluded.path,
         updated_at = datetime('now')`,
      [song.id, song.title, song.album_id, song.artist_id, song.album_name,
       song.artist_name, song.track_number, song.disc_number, song.year,
       song.genre, song.duration, song.bit_rate, song.bit_depth,
       song.sampling_rate, song.channel_count, song.file_size,
       song.content_type, song.suffix, song.r2_key, song.cover_art_r2_key, song.path]
    );
  }

  async updateAlbumCounts(albumId: string): Promise<void> {
    await this.execute(
      `UPDATE albums SET
        song_count = (SELECT COUNT(*) FROM songs WHERE album_id = ?),
        duration = (SELECT COALESCE(SUM(duration), 0) FROM songs WHERE album_id = ?),
        updated_at = datetime('now')
       WHERE id = ?`,
      [albumId, albumId, albumId]
    );
  }

  async updateArtistAlbumCount(artistId: string): Promise<void> {
    await this.execute(
      `UPDATE artists SET
        album_count = (SELECT COUNT(*) FROM albums WHERE artist_id = ?),
        updated_at = datetime('now')
       WHERE id = ?`,
      [artistId, artistId]
    );
  }

  async upsertGenre(name: string): Promise<void> {
    await this.execute(
      `INSERT INTO genres (name, song_count, album_count)
       VALUES (?,
         (SELECT COUNT(*) FROM songs WHERE genre = ?),
         (SELECT COUNT(DISTINCT album_id) FROM songs WHERE genre = ?))
       ON CONFLICT(name) DO UPDATE SET
         song_count = (SELECT COUNT(*) FROM songs WHERE genre = ?),
         album_count = (SELECT COUNT(DISTINCT album_id) FROM songs WHERE genre = ?)`,
      [name, name, name, name, name]
    );
  }

  async createUser(id: string, username: string, password: string, isAdmin: boolean): Promise<void> {
    await this.execute(
      'INSERT INTO users (id, username, password_hash, is_admin) VALUES (?, ?, ?, ?)',
      [id, username, password, isAdmin ? 1 : 0]
    );
  }

  async getStats(): Promise<{
    artists: number;
    albums: number;
    songs: number;
    users: number;
    genres: number;
  }> {
    const [artists, albums, songs, users, genres] = await Promise.all([
      this.execute('SELECT COUNT(*) as count FROM artists'),
      this.execute('SELECT COUNT(*) as count FROM albums'),
      this.execute('SELECT COUNT(*) as count FROM songs'),
      this.execute('SELECT COUNT(*) as count FROM users'),
      this.execute('SELECT COUNT(*) as count FROM genres'),
    ]);

    return {
      artists: (artists.results[0]?.count as number) || 0,
      albums: (albums.results[0]?.count as number) || 0,
      songs: (songs.results[0]?.count as number) || 0,
      users: (users.results[0]?.count as number) || 0,
      genres: (genres.results[0]?.count as number) || 0,
    };
  }

  async findUnknownArtistSongs(): Promise<{ id: string; title: string; r2_key: string; cover_art_r2_key: string | null; artist_id: string; album_id: string }[]> {
    const result = await this.execute(
      `SELECT id, title, r2_key, cover_art_r2_key, artist_id, album_id
       FROM songs WHERE artist_name = 'Unknown Artist'`
    );
    return result.results as { id: string; title: string; r2_key: string; cover_art_r2_key: string | null; artist_id: string; album_id: string }[];
  }

  async deleteSong(id: string): Promise<void> {
    // Delete references in other tables first (foreign key constraints)
    await this.execute('DELETE FROM play_counts WHERE song_id = ?', [id]);
    await this.execute('DELETE FROM play_history WHERE song_id = ?', [id]);
    await this.execute('DELETE FROM playlist_songs WHERE song_id = ?', [id]);
    await this.execute('DELETE FROM starred WHERE item_id = ? AND item_type = ?', [id, 'song']);
    await this.execute('DELETE FROM ratings WHERE item_id = ? AND item_type = ?', [id, 'song']);
    // Clear play queue references
    await this.execute(
      `UPDATE play_queue SET current_song_id = NULL WHERE current_song_id = ?`, [id]
    );
    await this.execute('DELETE FROM songs WHERE id = ?', [id]);
  }

  async deleteAlbumIfEmpty(albumId: string): Promise<boolean> {
    const result = await this.execute('SELECT COUNT(*) as count FROM songs WHERE album_id = ?', [albumId]);
    const count = result.results[0]?.count as number;
    if (count === 0) {
      await this.execute('DELETE FROM albums WHERE id = ?', [albumId]);
      return true;
    }
    return false;
  }

  async deleteArtistIfEmpty(artistId: string): Promise<boolean> {
    const result = await this.execute('SELECT COUNT(*) as count FROM albums WHERE artist_id = ?', [artistId]);
    const count = result.results[0]?.count as number;
    if (count === 0) {
      await this.execute('DELETE FROM artists WHERE id = ?', [artistId]);
      return true;
    }
    return false;
  }

  async nukeAll(): Promise<void> {
    const tables = [
      'play_queue', 'play_counts', 'play_history',
      'playlist_songs', 'playlists',
      'ratings', 'starred',
      'songs', 'albums', 'artists', 'genres', 'users',
    ];
    for (const table of tables) {
      await this.execute(`DELETE FROM ${table}`);
    }
  }
}
