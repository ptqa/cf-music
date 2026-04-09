# Cloudflare Music Server — Implementation Plan

A self-hosted music streaming server running entirely on Cloudflare's edge infrastructure (Workers + R2 + D1), implementing the Subsonic/OpenSubsonic API for compatibility with dozens of existing mobile, desktop, and TV clients.

## Why

- Spotify/YouTube Music restrictions (device limits, region locks, streaming quality)
- Own your music library as mp3 files
- Zero egress fees (R2's killer feature for audio streaming)
- No server to manage — fully serverless, globally distributed
- Instant access to 20+ existing Subsonic client apps

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Cloudflare Edge                            │
│                                                              │
│  ┌─────────────────┐    ┌──────────┐    ┌─────────────────┐ │
│  │  Worker          │───>│  D1      │    │  R2 Bucket      │ │
│  │  (Subsonic API)  │    │ (SQLite) │    │  (audio files)  │ │
│  │                  │────────────────────>│                 │ │
│  └────────^─────────┘    └──────────┘    └─────────────────┘ │
│           │                                       ^          │
└───────────┼───────────────────────────────────────┼──────────┘
            │                                       │
    ┌───────┴─────────┐                   ┌─────────┴─────────┐
    │  Subsonic        │                   │  CLI Scanner      │
    │  Clients         │                   │  (local, bun)     │
    │  DSub, play:Sub  │                   │  reads ID3 tags   │
    │  Substreamer     │                   │  uploads to R2    │
    │  Symphonium      │                   │  writes to D1     │
    └─────────────────┘                   └───────────────────┘
```

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| API Server | Cloudflare Worker (TypeScript) | Subsonic API, auth, routing |
| Database | Cloudflare D1 (SQLite) | Song/album/artist metadata, playlists, play counts |
| File Storage | Cloudflare R2 | mp3 files, cover art images |
| Scanner/Uploader | TypeScript CLI (Bun) | ID3 tag extraction, R2 upload, D1 metadata population |
| Clients | Existing Subsonic apps | DSub (Android), play:Sub (iOS), Substreamer (TV), Symphonium, etc. |

## Constraints & Tradeoffs

| Constraint | Impact | Mitigation |
|-----------|--------|-----------|
| No transcoding (no FFmpeg on Workers) | Must serve files as-is | Store mp3s at 320kbps or V0; clients that request maxBitRate get raw files |
| 128MB Worker memory | Cannot buffer full audio files | Stream directly from R2 via ReadableStream — zero buffering |
| D1 max 10GB per database | Metadata only, no blobs | 10GB holds metadata for millions of songs |
| D1 single-threaded | ~1000 QPS at 1ms/query | Aggressive indexing, keep queries simple |
| Worker CPU limit (30s paid) | Can't scan metadata on-edge | Scanner runs locally via CLI |
| Subsonic JSON quirk | Single-element arrays collapse to objects | Implement custom JSON serializer |

---

## D1 Database Schema

```sql
-- Users (supports multi-user)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,      -- stored to allow md5(password + salt) verification
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Artists (from ID3 tags)
CREATE TABLE artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_name TEXT,                   -- for alphabetical sorting (e.g. "Beatles, The")
  cover_art_r2_key TEXT,
  album_count INTEGER NOT NULL DEFAULT 0,
  musicbrainz_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_artists_name ON artists(name);
CREATE INDEX idx_artists_sort_name ON artists(sort_name);

-- Albums (from ID3 tags)
CREATE TABLE albums (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  artist_id TEXT NOT NULL REFERENCES artists(id),
  artist_name TEXT NOT NULL,        -- denormalized for fast queries
  cover_art_r2_key TEXT,
  song_count INTEGER NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 0,  -- total seconds
  year INTEGER,
  genre TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_albums_artist_id ON albums(artist_id);
CREATE INDEX idx_albums_name ON albums(name);
CREATE INDEX idx_albums_year ON albums(year);
CREATE INDEX idx_albums_genre ON albums(genre);
CREATE INDEX idx_albums_created_at ON albums(created_at);

-- Songs (from ID3 tags)
CREATE TABLE songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  album_id TEXT NOT NULL REFERENCES albums(id),
  artist_id TEXT NOT NULL REFERENCES artists(id),
  album_name TEXT NOT NULL,         -- denormalized
  artist_name TEXT NOT NULL,        -- denormalized
  track_number INTEGER,
  disc_number INTEGER DEFAULT 1,
  year INTEGER,
  genre TEXT,
  duration INTEGER,                 -- seconds
  bit_rate INTEGER,                 -- kbps
  bit_depth INTEGER,
  sampling_rate INTEGER,
  channel_count INTEGER,
  file_size INTEGER,                -- bytes
  content_type TEXT NOT NULL DEFAULT 'audio/mpeg',
  suffix TEXT NOT NULL DEFAULT 'mp3',
  r2_key TEXT NOT NULL,             -- R2 object key
  cover_art_r2_key TEXT,
  path TEXT NOT NULL,               -- virtual path: "Artist/Album/01 - Title.mp3"
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_songs_album_id ON songs(album_id);
CREATE INDEX idx_songs_artist_id ON songs(artist_id);
CREATE INDEX idx_songs_title ON songs(title);
CREATE INDEX idx_songs_genre ON songs(genre);
CREATE INDEX idx_songs_created_at ON songs(created_at);

-- Starred items (per user)
CREATE TABLE starred (
  user_id TEXT NOT NULL REFERENCES users(id),
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL,          -- 'song', 'album', 'artist'
  starred_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, item_id, item_type)
);
CREATE INDEX idx_starred_user_type ON starred(user_id, item_type);

-- Ratings (per user)
CREATE TABLE ratings (
  user_id TEXT NOT NULL REFERENCES users(id),
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  PRIMARY KEY (user_id, item_id, item_type)
);

-- Playlists
CREATE TABLE playlists (
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
CREATE INDEX idx_playlists_user_id ON playlists(user_id);

-- Playlist entries (ordered)
CREATE TABLE playlist_songs (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, position)
);

-- Play history (scrobbles)
CREATE TABLE play_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  song_id TEXT NOT NULL REFERENCES songs(id),
  played_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_play_history_user_song ON play_history(user_id, song_id);
CREATE INDEX idx_play_history_played_at ON play_history(played_at);

-- Aggregated play counts
CREATE TABLE play_counts (
  user_id TEXT NOT NULL REFERENCES users(id),
  song_id TEXT NOT NULL REFERENCES songs(id),
  count INTEGER NOT NULL DEFAULT 0,
  last_played TEXT,
  PRIMARY KEY (user_id, song_id)
);

-- Play queue (cross-device resume)
CREATE TABLE play_queue (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  current_song_id TEXT REFERENCES songs(id),
  position INTEGER DEFAULT 0,       -- position in ms
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  changed_by TEXT,
  song_ids TEXT NOT NULL DEFAULT '[]'  -- JSON array of song IDs
);

-- Genres (pre-aggregated)
CREATE TABLE genres (
  name TEXT PRIMARY KEY,
  song_count INTEGER NOT NULL DEFAULT 0,
  album_count INTEGER NOT NULL DEFAULT 0
);
```

---

## Subsonic API Endpoints

### Authentication

All requests include query parameters:
- `u` — username
- `t` — auth token: `md5(password + salt)`
- `s` — random salt (min 6 chars)
- `v` — API version (report `1.16.1`)
- `c` — client name
- `f` — response format (`xml` default, `json`)

Implementation: look up user, compute `md5(stored_password + s)`, compare with `t`. Error code `40` on mismatch.

Note: Subsonic auth requires knowing the plaintext password to verify tokens. Store passwords in a way that supports this (e.g. encrypted, not hashed). This is a known protocol limitation — acceptable for personal use over HTTPS.

### Response Envelope

Every response wraps in:

```json
{
  "subsonic-response": {
    "status": "ok",
    "version": "1.16.1",
    "type": "CloudflareMusic",
    "serverVersion": "0.1.0",
    "openSubsonic": true
  }
}
```

**Critical JSON quirk:** Single-element arrays collapse to bare objects. Empty arrays are omitted. Must implement a custom serializer.

### ID Scheme

UUIDs for all entities. Cover art IDs use prefixes:
- `ar-{artistId}` — artist cover art
- `al-{albumId}` — album cover art
- `{songId}` — song embedded cover art

### URL Routing

All endpoints under `/rest/`. Both `/rest/ping` and `/rest/ping.view` must work (strip `.view` suffix).

### Phase 1: Core (MVP)

| Endpoint | Purpose |
|----------|---------|
| `ping` | Auth test, client handshake |
| `getLicense` | Always return `valid=true` |
| `getUser` | Return user permissions |
| `getMusicFolders` | Return single "Music" folder |
| `getIndexes` | Alphabetical artist index (folder-based) |
| `getMusicDirectory` | Folder drill-down |
| `getArtists` | Alphabetical artist index (ID3-based) |
| `getArtist` | Artist detail + albums |
| `getAlbum` | Album detail + songs |
| `getSong` | Single song metadata |
| `getAlbumList2` | Album lists (random, newest, recent, frequent, starred, alphabetical, byYear, byGenre) |
| `search3` | Search artists/albums/songs (ID3) |
| `search2` | Search (folder-based) |
| `stream` | Stream audio from R2 (with Range request support) |
| `download` | Download raw audio from R2 |
| `getCoverArt` | Serve cover art from R2 |

### Phase 2: User Features

| Endpoint | Purpose |
|----------|---------|
| `star` / `unstar` | Favorite items |
| `getStarred2` / `getStarred` | List favorites |
| `setRating` | Rate items 1-5 |
| `scrobble` | Report playback, increment play counts |
| `getRandomSongs` | Shuffle mode |
| `getGenres` | List genres |
| `getSongsByGenre` | Browse by genre |
| `getAlbumList` | Folder-based album lists |

### Phase 3: Playlists & Sync

| Endpoint | Purpose |
|----------|---------|
| `getPlaylists` / `getPlaylist` | List/view playlists |
| `createPlaylist` / `updatePlaylist` / `deletePlaylist` | Playlist CRUD |
| `savePlayQueue` / `getPlayQueue` | Cross-device play queue |
| `getNowPlaying` | Currently playing |
| `getLyrics` | Lyrics lookup |

---

## Streaming Implementation

```typescript
async function handleStream(request: Request, env: Env, songId: string): Promise<Response> {
  const song = await db.getSong(songId);
  if (!song) return subsonicError(70, 'Song not found');

  const rangeHeader = request.headers.get('Range');

  if (rangeHeader) {
    const { start, end } = parseRange(rangeHeader, song.file_size);
    const object = await env.BUCKET.get(song.r2_key, {
      range: { offset: start, length: end - start + 1 }
    });
    return new Response(object.body, {
      status: 206,
      headers: {
        'Content-Type': song.content_type,
        'Content-Range': `bytes ${start}-${end}/${song.file_size}`,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
      }
    });
  }

  const object = await env.BUCKET.get(song.r2_key);
  return new Response(object.body, {
    headers: {
      'Content-Type': song.content_type,
      'Content-Length': String(song.file_size),
      'Accept-Ranges': 'bytes',
    }
  });
}
```

---

## CLI Scanner Tool

### Tech
- Runtime: Bun
- ID3 parsing: `music-metadata` npm package
- R2 access: `@aws-sdk/client-s3` with R2 endpoint
- D1 access: Cloudflare REST API

### Commands

```bash
music-cli scan /path/to/music/    # Scan directory, upload, populate metadata
music-cli add /path/to/song.mp3   # Single file
music-cli rescan                   # Re-read metadata without re-uploading
music-cli stats                    # Library statistics
music-cli user create --username tony --password secret
music-cli nuke --confirm           # Delete everything
```

### Scan Process

For each audio file:
1. Read ID3 tags (title, artist, album, track, disc, year, genre, duration, bitrate, etc.)
2. Extract embedded cover art
3. Determine R2 key: `music/{Artist}/{Album}/{Disc}-{Track} - {Title}.{suffix}`
4. Upload audio to R2 (skip if exists with same size)
5. Upload cover art: `covers/al-{albumId}.jpg`, `covers/ar-{artistId}.jpg`
6. Upsert artist, album, song records to D1
7. Update genre aggregates

### Configuration

```toml
# music-cli.toml
[cloudflare]
account_id = "xxx"
api_token = "xxx"

[r2]
bucket_name = "music"
endpoint = "https://{account_id}.r2.cloudflarestorage.com"
access_key_id = "xxx"
secret_access_key = "xxx"

[d1]
database_id = "xxx"
```

---

## Project Structure

```
cloudflare-music-server/
├── worker/
│   ├── src/
│   │   ├── index.ts              # Entry point, router
│   │   ├── auth.ts               # Subsonic token auth
│   │   ├── response.ts           # Response envelope + JSON quirk serializer
│   │   ├── handlers/
│   │   │   ├── system.ts         # ping, getLicense, getUser
│   │   │   ├── browsing.ts       # getArtists, getArtist, getAlbum, getSong, getIndexes, getMusicDirectory
│   │   │   ├── lists.ts          # getAlbumList2, getAlbumList, getRandomSongs, getSongsByGenre
│   │   │   ├── search.ts         # search2, search3
│   │   │   ├── media.ts          # stream, download, getCoverArt
│   │   │   ├── playlists.ts      # playlist CRUD
│   │   │   ├── bookmarks.ts      # play queue save/load
│   │   │   └── annotation.ts     # star, unstar, scrobble, setRating
│   │   ├── db/
│   │   │   ├── schema.sql        # D1 schema
│   │   │   ├── queries.ts        # Database query functions
│   │   │   └── migrations/       # D1 migrations
│   │   └── types.ts              # TypeScript types
│   ├── wrangler.toml
│   ├── package.json
│   └── tsconfig.json
│
├── cli/
│   ├── src/
│   │   ├── index.ts              # CLI entry (commander.js)
│   │   ├── scanner.ts            # Directory traversal + ID3 reading
│   │   ├── uploader.ts           # R2 upload logic
│   │   ├── db.ts                 # D1 REST API client
│   │   └── config.ts             # Config loading
│   ├── package.json
│   └── tsconfig.json
│
├── music-cli.toml.example
└── README.md
```

---

## Wrangler Configuration

```toml
name = "music-server"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
SERVER_NAME = "CloudflareMusic"
SERVER_VERSION = "0.1.0"

[[d1_databases]]
binding = "DB"
database_name = "music-metadata"
database_id = "to-be-created"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "music"
```

---

## Implementation Order

### Step 1: Infrastructure Setup
- Create Cloudflare R2 bucket
- Create Cloudflare D1 database
- Initialize Worker project with wrangler
- Apply D1 schema migration
- Configure R2 S3 API credentials for CLI

### Step 2: CLI Scanner (build first — need data to test API)
- Project setup (Bun, TypeScript, dependencies)
- Config file loading
- Directory traversal and file discovery
- ID3 tag extraction with music-metadata
- Cover art extraction and upload to R2
- Audio file upload to R2 (with dedup)
- D1 metadata upsert via REST API
- User creation command
- Test with a few mp3 files

### Step 3: Worker API — Phase 1 (Core)
- Router + .view suffix handling
- Auth middleware
- Subsonic response envelope (XML + JSON + array quirk)
- System endpoints (ping, getLicense, getUser)
- getMusicFolders
- Browsing endpoints (getArtists, getArtist, getAlbum, getSong, getIndexes, getMusicDirectory)
- List endpoints (getAlbumList2 with all type variants)
- Search endpoints (search3, search2)
- Media endpoints (stream with Range support, download, getCoverArt)
- Test with DSub and/or play:Sub

### Step 4: Worker API — Phase 2 (User Features)
- star / unstar / getStarred2 / getStarred
- setRating
- scrobble
- getRandomSongs
- getGenres / getSongsByGenre
- getAlbumList (folder-based)

### Step 5: Worker API — Phase 3 (Playlists & Sync)
- Playlist CRUD
- Play queue save/load
- getNowPlaying

### Step 6: Polish
- Error handling edge cases
- Custom domain setup
- Multi-client testing (DSub, play:Sub, Substreamer, Symphonium)
- Performance testing with large library

---

## Client Compatibility Targets

| Client | Platform | Priority | Browsing Mode |
|--------|----------|----------|---------------|
| DSub | Android | High | Folder + ID3 |
| play:Sub | iOS | High | ID3 |
| Substreamer | Android TV / Fire TV | High | ID3 |
| Symphonium | Android | Medium | ID3 |
| Sublime Music | Linux/Desktop | Medium | Both |
| Feishin | Desktop (Electron) | Medium | ID3 |

---

## Cost Estimate (Personal Use)

Assuming ~5000 songs (~25GB), single user, ~2 hours listening/day:

| Service | Usage | Monthly Cost |
|---------|-------|-------------|
| Workers | ~10K req/day | Free tier |
| R2 Storage | ~25GB | ~$0.23 |
| R2 Reads | ~3K GetObject/day | Free tier |
| R2 Egress | ~2GB/day | $0 (always free) |
| D1 Storage | ~50MB | Free tier |
| D1 Reads | ~50K rows/day | Free tier |

**Estimated total: ~$0.23/month** (or $0 if library under 10GB)

---

## Future Ideas

1. **Web UI** — Cloudflare Pages SPA (React) using the same Worker API
2. **Pre-transcoding** — Store multiple bitrate variants on R2 during scan
3. **Last.fm scrobbling** — Forward scrobble events to Last.fm API from Worker
4. **FLAC support** — Scanner handles it; consider pre-transcoding to mp3 for client compat
5. **Lyrics** — Integrate with LRCLIB or similar free lyrics API
6. **R2 event notifications** — Auto-trigger metadata scanning on upload when available
7. **Waveform generation** — Pre-compute waveform data during scan for visual players
