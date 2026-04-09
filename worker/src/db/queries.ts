import { type ArtistRow, type AlbumRow, type SongRow, type PlaylistRow, type PlayQueueRow, type GenreRow } from '../types';

// ─── Artists ────────────────────────────────────────────────────────────────

export async function getArtists(db: D1Database): Promise<ArtistRow[]> {
  const { results } = await db.prepare(
    'SELECT * FROM artists ORDER BY COALESCE(sort_name, name) COLLATE NOCASE'
  ).all<ArtistRow>();
  return results;
}

export async function getArtist(db: D1Database, id: string): Promise<ArtistRow | null> {
  return db.prepare('SELECT * FROM artists WHERE id = ?').bind(id).first<ArtistRow>();
}

// ─── Albums ─────────────────────────────────────────────────────────────────

export async function getAlbumsByArtist(db: D1Database, artistId: string): Promise<AlbumRow[]> {
  const { results } = await db.prepare(
    'SELECT * FROM albums WHERE artist_id = ? ORDER BY year, name'
  ).bind(artistId).all<AlbumRow>();
  return results;
}

export async function getAlbum(db: D1Database, id: string): Promise<AlbumRow | null> {
  return db.prepare('SELECT * FROM albums WHERE id = ?').bind(id).first<AlbumRow>();
}

export async function getAlbumList2(
  db: D1Database,
  type: string,
  size: number,
  offset: number,
  extra: Record<string, string>
): Promise<AlbumRow[]> {
  let query: string;
  const binds: unknown[] = [];

  switch (type) {
    case 'random':
      query = 'SELECT * FROM albums ORDER BY RANDOM() LIMIT ?';
      binds.push(size);
      break;
    case 'newest':
      query = 'SELECT * FROM albums ORDER BY created_at DESC LIMIT ? OFFSET ?';
      binds.push(size, offset);
      break;
    case 'recent':
      // Most recently played albums
      query = `SELECT DISTINCT a.* FROM albums a
        JOIN songs s ON s.album_id = a.id
        JOIN play_counts pc ON pc.song_id = s.id
        ORDER BY pc.last_played DESC LIMIT ? OFFSET ?`;
      binds.push(size, offset);
      break;
    case 'frequent':
      query = `SELECT a.*, SUM(pc.count) as total_plays FROM albums a
        JOIN songs s ON s.album_id = a.id
        JOIN play_counts pc ON pc.song_id = s.id
        GROUP BY a.id ORDER BY total_plays DESC LIMIT ? OFFSET ?`;
      binds.push(size, offset);
      break;
    case 'starred':
      query = `SELECT a.* FROM albums a
        JOIN starred st ON st.item_id = a.id AND st.item_type = 'album'
        ORDER BY st.starred_at DESC LIMIT ? OFFSET ?`;
      binds.push(size, offset);
      break;
    case 'alphabeticalByName':
      query = 'SELECT * FROM albums ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?';
      binds.push(size, offset);
      break;
    case 'alphabeticalByArtist':
      query = 'SELECT * FROM albums ORDER BY artist_name COLLATE NOCASE, name COLLATE NOCASE LIMIT ? OFFSET ?';
      binds.push(size, offset);
      break;
    case 'byYear':
      const fromYear = parseInt(extra.fromYear || '0');
      const toYear = parseInt(extra.toYear || '9999');
      if (fromYear <= toYear) {
        query = 'SELECT * FROM albums WHERE year >= ? AND year <= ? ORDER BY year LIMIT ? OFFSET ?';
      } else {
        query = 'SELECT * FROM albums WHERE year >= ? AND year <= ? ORDER BY year DESC LIMIT ? OFFSET ?';
      }
      binds.push(Math.min(fromYear, toYear), Math.max(fromYear, toYear), size, offset);
      break;
    case 'byGenre':
      query = 'SELECT * FROM albums WHERE genre = ? ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?';
      binds.push(extra.genre || '', size, offset);
      break;
    default:
      query = 'SELECT * FROM albums ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?';
      binds.push(size, offset);
  }

  const stmt = db.prepare(query);
  const { results } = await (binds.length > 0 ? stmt.bind(...binds) : stmt).all<AlbumRow>();
  return results;
}

// ─── Songs ──────────────────────────────────────────────────────────────────

export async function getSongsByAlbum(db: D1Database, albumId: string): Promise<SongRow[]> {
  const { results } = await db.prepare(
    'SELECT * FROM songs WHERE album_id = ? ORDER BY disc_number, track_number'
  ).bind(albumId).all<SongRow>();
  return results;
}

export async function getSong(db: D1Database, id: string): Promise<SongRow | null> {
  return db.prepare('SELECT * FROM songs WHERE id = ?').bind(id).first<SongRow>();
}

export async function getRandomSongs(db: D1Database, size: number, genre?: string, fromYear?: number, toYear?: number): Promise<SongRow[]> {
  let query = 'SELECT * FROM songs WHERE 1=1';
  const binds: unknown[] = [];

  if (genre) {
    query += ' AND genre = ?';
    binds.push(genre);
  }
  if (fromYear) {
    query += ' AND year >= ?';
    binds.push(fromYear);
  }
  if (toYear) {
    query += ' AND year <= ?';
    binds.push(toYear);
  }

  query += ' ORDER BY RANDOM() LIMIT ?';
  binds.push(size);

  const stmt = db.prepare(query);
  const { results } = await (binds.length > 0 ? stmt.bind(...binds) : stmt).all<SongRow>();
  return results;
}

export async function getSongsByGenre(db: D1Database, genre: string, count: number, offset: number): Promise<SongRow[]> {
  const { results } = await db.prepare(
    'SELECT * FROM songs WHERE genre = ? ORDER BY album_name, disc_number, track_number LIMIT ? OFFSET ?'
  ).bind(genre, count, offset).all<SongRow>();
  return results;
}

// ─── Search ─────────────────────────────────────────────────────────────────

export async function searchArtists(db: D1Database, query: string, count: number, offset: number): Promise<ArtistRow[]> {
  const like = `%${query}%`;
  const { results } = await db.prepare(
    'SELECT * FROM artists WHERE name LIKE ? ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?'
  ).bind(like, count, offset).all<ArtistRow>();
  return results;
}

export async function searchAlbums(db: D1Database, query: string, count: number, offset: number): Promise<AlbumRow[]> {
  const like = `%${query}%`;
  const { results } = await db.prepare(
    'SELECT * FROM albums WHERE name LIKE ? ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?'
  ).bind(like, count, offset).all<AlbumRow>();
  return results;
}

export async function searchSongs(db: D1Database, query: string, count: number, offset: number): Promise<SongRow[]> {
  const like = `%${query}%`;
  const { results } = await db.prepare(
    'SELECT * FROM songs WHERE title LIKE ? ORDER BY title COLLATE NOCASE LIMIT ? OFFSET ?'
  ).bind(like, count, offset).all<SongRow>();
  return results;
}

// ─── Starred ────────────────────────────────────────────────────────────────

export async function star(db: D1Database, userId: string, itemId: string, itemType: string): Promise<void> {
  await db.prepare(
    'INSERT OR IGNORE INTO starred (user_id, item_id, item_type) VALUES (?, ?, ?)'
  ).bind(userId, itemId, itemType).run();
}

export async function unstar(db: D1Database, userId: string, itemId: string, itemType: string): Promise<void> {
  await db.prepare(
    'DELETE FROM starred WHERE user_id = ? AND item_id = ? AND item_type = ?'
  ).bind(userId, itemId, itemType).run();
}

export async function getStarredArtists(db: D1Database, userId: string): Promise<(ArtistRow & { starred_at: string })[]> {
  const { results } = await db.prepare(
    `SELECT a.*, st.starred_at FROM artists a
     JOIN starred st ON st.item_id = a.id AND st.item_type = 'artist'
     WHERE st.user_id = ? ORDER BY a.name COLLATE NOCASE`
  ).bind(userId).all<ArtistRow & { starred_at: string }>();
  return results;
}

export async function getStarredAlbums(db: D1Database, userId: string): Promise<(AlbumRow & { starred_at: string })[]> {
  const { results } = await db.prepare(
    `SELECT a.*, st.starred_at FROM albums a
     JOIN starred st ON st.item_id = a.id AND st.item_type = 'album'
     WHERE st.user_id = ? ORDER BY a.name COLLATE NOCASE`
  ).bind(userId).all<AlbumRow & { starred_at: string }>();
  return results;
}

export async function getStarredSongs(db: D1Database, userId: string): Promise<(SongRow & { starred_at: string })[]> {
  const { results } = await db.prepare(
    `SELECT s.*, st.starred_at FROM songs s
     JOIN starred st ON st.item_id = s.id AND st.item_type = 'song'
     WHERE st.user_id = ? ORDER BY s.title COLLATE NOCASE`
  ).bind(userId).all<SongRow & { starred_at: string }>();
  return results;
}

// ─── Ratings ────────────────────────────────────────────────────────────────

export async function setRating(db: D1Database, userId: string, itemId: string, itemType: string, rating: number): Promise<void> {
  if (rating === 0) {
    await db.prepare('DELETE FROM ratings WHERE user_id = ? AND item_id = ? AND item_type = ?')
      .bind(userId, itemId, itemType).run();
  } else {
    await db.prepare(
      'INSERT INTO ratings (user_id, item_id, item_type, rating) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, item_id, item_type) DO UPDATE SET rating = ?'
    ).bind(userId, itemId, itemType, rating, rating).run();
  }
}

// ─── Scrobble ───────────────────────────────────────────────────────────────

export async function scrobble(db: D1Database, userId: string, songId: string): Promise<void> {
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare('INSERT INTO play_history (id, user_id, song_id) VALUES (?, ?, ?)').bind(id, userId, songId),
    db.prepare(
      `INSERT INTO play_counts (user_id, song_id, count, last_played)
       VALUES (?, ?, 1, datetime('now'))
       ON CONFLICT(user_id, song_id) DO UPDATE SET count = count + 1, last_played = datetime('now')`
    ).bind(userId, songId),
  ]);
}

// ─── Playlists ──────────────────────────────────────────────────────────────

export async function getPlaylists(db: D1Database, userId: string): Promise<PlaylistRow[]> {
  const { results } = await db.prepare(
    'SELECT * FROM playlists WHERE user_id = ? OR is_public = 1 ORDER BY name COLLATE NOCASE'
  ).bind(userId).all<PlaylistRow>();
  return results;
}

export async function getPlaylist(db: D1Database, id: string): Promise<PlaylistRow | null> {
  return db.prepare('SELECT * FROM playlists WHERE id = ?').bind(id).first<PlaylistRow>();
}

export async function getPlaylistSongs(db: D1Database, playlistId: string): Promise<SongRow[]> {
  const { results } = await db.prepare(
    `SELECT s.* FROM songs s
     JOIN playlist_songs ps ON ps.song_id = s.id
     WHERE ps.playlist_id = ?
     ORDER BY ps.position`
  ).bind(playlistId).all<SongRow>();
  return results;
}

export async function createPlaylist(db: D1Database, id: string, name: string, userId: string, songIds: string[]): Promise<void> {
  const stmts = [
    db.prepare('INSERT INTO playlists (id, name, user_id, song_count) VALUES (?, ?, ?, ?)')
      .bind(id, name, userId, songIds.length),
  ];

  for (let i = 0; i < songIds.length; i++) {
    stmts.push(
      db.prepare('INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)')
        .bind(id, songIds[i], i)
    );
  }

  // Update duration
  if (songIds.length > 0) {
    stmts.push(
      db.prepare(
        `UPDATE playlists SET duration = (
          SELECT COALESCE(SUM(s.duration), 0) FROM songs s
          JOIN playlist_songs ps ON ps.song_id = s.id
          WHERE ps.playlist_id = ?
        ) WHERE id = ?`
      ).bind(id, id)
    );
  }

  await db.batch(stmts);
}

export async function updatePlaylist(db: D1Database, id: string, name?: string, comment?: string, isPublic?: boolean, songIdsToAdd?: string[], songIndexesToRemove?: number[]): Promise<void> {
  const stmts: D1PreparedStatement[] = [];

  if (name !== undefined) {
    stmts.push(db.prepare("UPDATE playlists SET name = ?, updated_at = datetime('now') WHERE id = ?").bind(name, id));
  }
  if (comment !== undefined) {
    stmts.push(db.prepare("UPDATE playlists SET comment = ?, updated_at = datetime('now') WHERE id = ?").bind(comment, id));
  }
  if (isPublic !== undefined) {
    stmts.push(db.prepare("UPDATE playlists SET is_public = ?, updated_at = datetime('now') WHERE id = ?").bind(isPublic ? 1 : 0, id));
  }

  // Remove songs by index (in reverse order to maintain positions)
  if (songIndexesToRemove && songIndexesToRemove.length > 0) {
    const sorted = [...songIndexesToRemove].sort((a, b) => b - a);
    for (const idx of sorted) {
      stmts.push(
        db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ? AND position = ?').bind(id, idx)
      );
    }
    // Re-number positions
    stmts.push(
      db.prepare(
        `UPDATE playlist_songs SET position = (
          SELECT COUNT(*) FROM playlist_songs ps2
          WHERE ps2.playlist_id = playlist_songs.playlist_id
          AND ps2.rowid < playlist_songs.rowid
        ) WHERE playlist_id = ?`
      ).bind(id)
    );
  }

  // Add songs
  if (songIdsToAdd && songIdsToAdd.length > 0) {
    for (const songId of songIdsToAdd) {
      stmts.push(
        db.prepare(
          `INSERT INTO playlist_songs (playlist_id, song_id, position)
           VALUES (?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM playlist_songs WHERE playlist_id = ?))`
        ).bind(id, songId, id)
      );
    }
  }

  // Update counts
  stmts.push(
    db.prepare(
      `UPDATE playlists SET
        song_count = (SELECT COUNT(*) FROM playlist_songs WHERE playlist_id = ?),
        duration = (SELECT COALESCE(SUM(s.duration), 0) FROM songs s JOIN playlist_songs ps ON ps.song_id = s.id WHERE ps.playlist_id = ?),
        updated_at = datetime('now')
       WHERE id = ?`
    ).bind(id, id, id)
  );

  if (stmts.length > 0) {
    await db.batch(stmts);
  }
}

export async function deletePlaylist(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ?').bind(id),
    db.prepare('DELETE FROM playlists WHERE id = ?').bind(id),
  ]);
}

// ─── Play Queue ─────────────────────────────────────────────────────────────

export async function savePlayQueue(db: D1Database, userId: string, currentId: string, position: number, songIds: string[], changedBy: string): Promise<void> {
  await db.prepare(
    `INSERT INTO play_queue (user_id, current_song_id, position, song_ids, changed_by, changed_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       current_song_id = ?, position = ?, song_ids = ?, changed_by = ?, changed_at = datetime('now')`
  ).bind(userId, currentId, position, JSON.stringify(songIds), changedBy,
         currentId, position, JSON.stringify(songIds), changedBy).run();
}

export async function getPlayQueue(db: D1Database, userId: string): Promise<PlayQueueRow | null> {
  return db.prepare('SELECT * FROM play_queue WHERE user_id = ?').bind(userId).first<PlayQueueRow>();
}

// ─── Genres ─────────────────────────────────────────────────────────────────

export async function getGenres(db: D1Database): Promise<GenreRow[]> {
  const { results } = await db.prepare(
    'SELECT * FROM genres ORDER BY name COLLATE NOCASE'
  ).all<GenreRow>();
  return results;
}

// ─── Music Directory (folder-based browsing) ────────────────────────────────

export async function getArtistSongs(db: D1Database, artistId: string): Promise<SongRow[]> {
  const { results } = await db.prepare(
    'SELECT * FROM songs WHERE artist_id = ? ORDER BY album_name, disc_number, track_number'
  ).bind(artistId).all<SongRow>();
  return results;
}
