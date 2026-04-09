-- Users (supports multi-user)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Artists (from ID3 tags)
CREATE TABLE IF NOT EXISTS artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_name TEXT,
  cover_art_r2_key TEXT,
  album_count INTEGER NOT NULL DEFAULT 0,
  musicbrainz_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name);
CREATE INDEX IF NOT EXISTS idx_artists_sort_name ON artists(sort_name);

-- Albums (from ID3 tags)
CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  artist_id TEXT NOT NULL REFERENCES artists(id),
  artist_name TEXT NOT NULL,
  cover_art_r2_key TEXT,
  song_count INTEGER NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 0,
  year INTEGER,
  genre TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_albums_artist_id ON albums(artist_id);
CREATE INDEX IF NOT EXISTS idx_albums_name ON albums(name);
CREATE INDEX IF NOT EXISTS idx_albums_year ON albums(year);
CREATE INDEX IF NOT EXISTS idx_albums_genre ON albums(genre);
CREATE INDEX IF NOT EXISTS idx_albums_created_at ON albums(created_at);

-- Songs (from ID3 tags)
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  album_id TEXT NOT NULL REFERENCES albums(id),
  artist_id TEXT NOT NULL REFERENCES artists(id),
  album_name TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  track_number INTEGER,
  disc_number INTEGER DEFAULT 1,
  year INTEGER,
  genre TEXT,
  duration INTEGER,
  bit_rate INTEGER,
  bit_depth INTEGER,
  sampling_rate INTEGER,
  channel_count INTEGER,
  file_size INTEGER,
  content_type TEXT NOT NULL DEFAULT 'audio/mpeg',
  suffix TEXT NOT NULL DEFAULT 'mp3',
  r2_key TEXT NOT NULL,
  cover_art_r2_key TEXT,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_songs_album_id ON songs(album_id);
CREATE INDEX IF NOT EXISTS idx_songs_artist_id ON songs(artist_id);
CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
CREATE INDEX IF NOT EXISTS idx_songs_genre ON songs(genre);
CREATE INDEX IF NOT EXISTS idx_songs_created_at ON songs(created_at);

-- Starred items (per user)
CREATE TABLE IF NOT EXISTS starred (
  user_id TEXT NOT NULL REFERENCES users(id),
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  starred_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, item_id, item_type)
);
CREATE INDEX IF NOT EXISTS idx_starred_user_type ON starred(user_id, item_type);

-- Ratings (per user)
CREATE TABLE IF NOT EXISTS ratings (
  user_id TEXT NOT NULL REFERENCES users(id),
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  PRIMARY KEY (user_id, item_id, item_type)
);

-- Playlists
CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  comment TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  song_count INTEGER NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_playlists_user_id ON playlists(user_id);

-- Playlist entries (ordered)
CREATE TABLE IF NOT EXISTS playlist_songs (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, position)
);

-- Play history (scrobbles)
CREATE TABLE IF NOT EXISTS play_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  song_id TEXT NOT NULL REFERENCES songs(id),
  played_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_play_history_user_song ON play_history(user_id, song_id);
CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at);

-- Aggregated play counts
CREATE TABLE IF NOT EXISTS play_counts (
  user_id TEXT NOT NULL REFERENCES users(id),
  song_id TEXT NOT NULL REFERENCES songs(id),
  count INTEGER NOT NULL DEFAULT 0,
  last_played TEXT,
  PRIMARY KEY (user_id, song_id)
);

-- Play queue (cross-device resume)
CREATE TABLE IF NOT EXISTS play_queue (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  current_song_id TEXT REFERENCES songs(id),
  position INTEGER DEFAULT 0,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  changed_by TEXT,
  song_ids TEXT NOT NULL DEFAULT '[]'
);

-- Genres (pre-aggregated)
CREATE TABLE IF NOT EXISTS genres (
  name TEXT PRIMARY KEY,
  song_count INTEGER NOT NULL DEFAULT 0,
  album_count INTEGER NOT NULL DEFAULT 0
);
