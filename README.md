# Cloudflare Music Server

A self-hosted music streaming server running entirely on Cloudflare's edge infrastructure (Workers + R2 + D1), implementing the [Subsonic/OpenSubsonic API](https://opensubsonic.netlify.app/) for compatibility with dozens of existing mobile, desktop, and TV clients.

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

## Why

- Own your music library — no device limits, region locks, or quality caps
- Zero egress fees (R2's killer feature for audio streaming)
- No server to manage — fully serverless, globally distributed
- Instant access to 20+ existing Subsonic client apps
- Costs ~$0.23/month for a 25GB library (or $0 if under 10GB)

## Compatible Clients

| Client | Platform | Browsing Mode |
|--------|----------|---------------|
| [DSub](https://play.google.com/store/apps/details?id=github.daneren2005.dsub) | Android | Folder + ID3 |
| [play:Sub](https://apps.apple.com/app/play-sub-music-streamer/id955329386) | iOS | ID3 |
| [Substreamer](https://substreamerapp.com/) | Android TV / Fire TV | ID3 |
| [Symphonium](https://symfonium.app/) | Android | ID3 |
| [Sublime Music](https://sublimemusic.app/) | Linux/Desktop | Both |
| [Feishin](https://github.com/jeffvli/feishin) | Desktop (Electron) | ID3 |

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) with Workers, R2, and D1 enabled
- [Bun](https://bun.sh/) runtime (for the CLI scanner)
- R2 S3 API credentials ([create here](https://dash.cloudflare.com/?to=/:account/r2/api-tokens))
- Cloudflare API token with D1 read/write permissions

## Setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/ptqa/cf-music.git
cd cf-music

# Worker
cd worker
bun install

# CLI
cd ../cli
bun install
```

### 2. Create Cloudflare resources

```bash
cd worker

# Create D1 database
npx wrangler d1 create music-metadata
# Note the database_id from the output

# Create R2 bucket
npx wrangler r2 bucket create music
```

### 3. Configure wrangler

```bash
# Copy the example and fill in your D1 database ID
cp wrangler.toml.example wrangler.toml
```

Edit `worker/wrangler.toml` and replace `YOUR_D1_DATABASE_ID` with the ID from step 2.

### 4. Apply database schema and deploy

```bash
cd worker

# Apply schema to remote D1
npx wrangler d1 execute music-metadata --remote --file=src/db/schema.sql

# Deploy the Worker
npx wrangler deploy
```

Your server is now live at `https://music-server.<your-account>.workers.dev`.

### 5. Configure CLI

```bash
# From the repo root
cp music-cli.toml.example music-cli.toml
```

Edit `music-cli.toml` with your Cloudflare credentials:

```toml
[cloudflare]
account_id = "your-account-id"
api_token = "your-api-token"

[r2]
bucket_name = "music"
endpoint = "https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com"
access_key_id = "your-r2-access-key"
secret_access_key = "your-r2-secret-key"

[d1]
database_id = "your-d1-database-id"
```

### 6. Create a user and scan your music

```bash
cd cli

# Create a user (password stored as plaintext — required by Subsonic auth protocol)
bun run cli user --username tony --password 'your-secure-password' --admin

# Scan your music library
bun run cli scan /path/to/your/music/

# Check library stats
bun run cli stats
```

### 7. Connect a client

Point any Subsonic-compatible client at your Worker URL:

- **Server:** `https://music-server.<your-account>.workers.dev`
- **Username / Password:** the credentials you created in step 6

## CLI Commands

```bash
# Scan a directory — reads ID3 tags, uploads audio + cover art to R2, populates D1
bun run cli scan /path/to/music/

# Add a single file
bun run cli add /path/to/song.mp3

# Show library statistics
bun run cli stats

# Create a user
bun run cli user --username <name> --password <pass> [--admin]

# Delete ALL metadata from D1 (does not delete R2 files)
bun run cli nuke --confirm
```

## Constraints & Design Decisions

- **No transcoding** — Workers don't have FFmpeg. Files are served as-is from R2. Store your music as mp3 (320kbps/V0) for best compatibility.
- **Streaming via R2** — Audio is streamed directly from R2 as a `ReadableStream` with full `Range` request support (HTTP 206). Zero buffering in Worker memory.
- **Subsonic JSON quirk** — Single-element arrays collapse to bare objects, empty arrays are omitted. A custom serializer handles this.
- **Plaintext passwords** — The Subsonic auth protocol requires `md5(password + salt)` verification, which means the server must know the plaintext password. This is a known protocol limitation, acceptable for personal use over HTTPS.
- **Deterministic IDs** — Song, album, and artist IDs are SHA-256 hashes of their metadata, making re-scans idempotent.

## Cost Estimate

Assuming ~5,000 songs (~25GB), single user, ~2 hours listening/day:

| Service | Usage | Monthly Cost |
|---------|-------|-------------|
| Workers | ~10K req/day | Free tier |
| R2 Storage | ~25GB | ~$0.23 |
| R2 Operations | ~3K reads/day | Free tier |
| R2 Egress | ~2GB/day | $0 (always free) |
| D1 Storage | ~50MB | Free tier |
| D1 Reads | ~50K rows/day | Free tier |

**Estimated total: ~$0.23/month**

## License

MIT
