export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  SERVER_NAME: string;
  SERVER_VERSION: string;
}

// Database row types
export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  is_admin: number;
  created_at: string;
  updated_at: string;
}

export interface ArtistRow {
  id: string;
  name: string;
  sort_name: string | null;
  cover_art_r2_key: string | null;
  album_count: number;
  musicbrainz_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlbumRow {
  id: string;
  name: string;
  artist_id: string;
  artist_name: string;
  cover_art_r2_key: string | null;
  song_count: number;
  duration: number;
  year: number | null;
  genre: string | null;
  created_at: string;
  updated_at: string;
}

export interface SongRow {
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
  file_size: number | null;
  content_type: string;
  suffix: string;
  r2_key: string;
  cover_art_r2_key: string | null;
  path: string;
  created_at: string;
  updated_at: string;
}

export interface StarredRow {
  user_id: string;
  item_id: string;
  item_type: string;
  starred_at: string;
}

export interface PlaylistRow {
  id: string;
  name: string;
  user_id: string;
  comment: string | null;
  is_public: number;
  song_count: number;
  duration: number;
  created_at: string;
  updated_at: string;
}

export interface PlayCountRow {
  user_id: string;
  song_id: string;
  count: number;
  last_played: string | null;
}

export interface PlayQueueRow {
  user_id: string;
  current_song_id: string | null;
  position: number;
  changed_at: string;
  changed_by: string | null;
  song_ids: string;
}

export interface GenreRow {
  name: string;
  song_count: number;
  album_count: number;
}

// Subsonic API types
export interface SubsonicParams {
  u: string;       // username
  t: string;       // auth token md5(password + salt)
  s: string;       // salt
  v: string;       // api version
  c: string;       // client name
  f: string;       // response format (xml | json)
}

export interface AuthenticatedRequest {
  user: UserRow;
  params: Record<string, string>;
  format: 'json' | 'xml';
  request: Request;
}
