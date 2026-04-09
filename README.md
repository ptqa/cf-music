# Cloudflare Music Server

A self-hosted music streaming server running on Cloudflare Workers + R2 + D1, implementing the Subsonic/OpenSubsonic API for compatibility with existing clients (DSub, play:Sub, Substreamer, Symphonium, etc.).

## Architecture

- **Worker** (TypeScript) -- Subsonic API server on Cloudflare's edge
- **R2** -- Audio file and cover art storage (zero egress fees)
- **D1** (SQLite) -- Song, album, artist metadata, playlists, play counts
- **CLI Scanner** (Bun) -- Local tool to read ID3 tags, upload files to R2, and populate D1

## Getting Started

### Prerequisites

- Cloudflare account with Workers, R2, and D1 enabled
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [Bun](https://bun.sh/) (for the CLI scanner)

### Setup

1. Create R2 bucket and D1 database via Cloudflare dashboard or Wrangler
2. Configure `wrangler.toml` with your D1 database ID and R2 bucket name
3. Apply the D1 schema migration
4. Deploy the Worker: `wrangler deploy`
5. Use the CLI scanner to upload your music library

## Cost

~$0.23/month for a 25GB / 5000-song library with daily use. Free if under 10GB.

## License

MIT
