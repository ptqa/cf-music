/**
 * Music directory scanner.
 * Reads ID3 tags, extracts cover art, generates deterministic IDs.
 */

import { readdir, stat, readFile } from 'fs/promises';
import { join, extname, basename } from 'path';
import { parseBuffer, type IAudioMetadata } from 'music-metadata';
import { type R2Uploader } from './uploader';
import { type D1Client } from './db';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.opus', '.wav', '.aac', '.wma']);

const MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',
};

interface ScanResult {
  total: number;
  uploaded: number;
  skipped: number;
  errors: number;
}

export class Scanner {
  private uploader: R2Uploader;
  private db: D1Client;
  private processedAlbums = new Set<string>();
  private processedArtists = new Set<string>();
  private genresToUpdate = new Set<string>();

  constructor(uploader: R2Uploader, db: D1Client) {
    this.uploader = uploader;
    this.db = db;
  }

  async scanDirectory(dirPath: string): Promise<ScanResult> {
    const result: ScanResult = { total: 0, uploaded: 0, skipped: 0, errors: 0 };
    const files = await this.findAudioFiles(dirPath);

    console.log(`Found ${files.length} audio files`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const progress = `[${i + 1}/${files.length}]`;

      try {
        const wasUploaded = await this.processFile(file);
        result.total++;
        if (wasUploaded) {
          result.uploaded++;
          console.log(`${progress} Uploaded: ${basename(file)}`);
        } else {
          result.skipped++;
          console.log(`${progress} Skipped: ${basename(file)}`);
        }
      } catch (err) {
        result.errors++;
        console.error(`${progress} Error: ${basename(file)} — ${err}`);
      }
    }

    // Update album counts, artist counts, and genres
    console.log('\nUpdating aggregates...');
    for (const albumId of this.processedAlbums) {
      await this.db.updateAlbumCounts(albumId);
    }
    for (const artistId of this.processedArtists) {
      await this.db.updateArtistAlbumCount(artistId);
    }
    for (const genre of this.genresToUpdate) {
      await this.db.upsertGenre(genre);
    }

    return result;
  }

  async processFile(filePath: string): Promise<boolean> {
    const fileBuffer = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'audio/mpeg';
    const suffix = ext.slice(1); // remove leading dot

    // Parse ID3/metadata
    const metadata = await parseBuffer(fileBuffer, { mimeType: contentType });

    const artistName = metadata.common.artist || metadata.common.albumartist || 'Unknown Artist';
    const albumName = metadata.common.album || 'Unknown Album';
    const title = metadata.common.title || basename(filePath, ext);
    const trackNumber = metadata.common.track?.no || null;
    const discNumber = metadata.common.disk?.no || 1;
    const year = metadata.common.year || null;
    const genre = metadata.common.genre?.[0] || null;
    const duration = metadata.format.duration ? Math.round(metadata.format.duration) : null;
    const bitRate = metadata.format.bitrate ? Math.round(metadata.format.bitrate / 1000) : null;
    const bitDepth = metadata.format.bitsPerSample || null;
    const samplingRate = metadata.format.sampleRate || null;
    const channelCount = metadata.format.numberOfChannels || null;
    const musicbrainzArtistId = (metadata.common.musicbrainz_artistid as string[] | undefined)?.[0] || null;

    // Generate deterministic IDs
    const artistId = await deterministicId(`artist:${artistName.toLowerCase()}`);
    const albumId = await deterministicId(`album:${artistName.toLowerCase()}:${albumName.toLowerCase()}`);
    const songId = await deterministicId(`song:${artistName.toLowerCase()}:${albumName.toLowerCase()}:${(discNumber || 1)}:${trackNumber || title.toLowerCase()}`);

    // Build R2 keys
    const safeName = (s: string) => s.replace(/[/\\?%*:|"<>]/g, '_').trim();
    const trackPrefix = trackNumber ? String(trackNumber).padStart(2, '0') : '00';
    const discPrefix = discNumber && discNumber > 1 ? `${discNumber}-` : '';
    const r2Key = `music/${safeName(artistName)}/${safeName(albumName)}/${discPrefix}${trackPrefix} - ${safeName(title)}.${suffix}`;
    const virtualPath = `${artistName}/${albumName}/${discPrefix}${trackPrefix} - ${title}.${suffix}`;

    // Upload audio to R2
    const wasUploaded = await this.uploader.uploadAudio(r2Key, fileBuffer, contentType);

    // Extract and upload cover art
    let coverArtR2Key: string | null = null;
    const coverArt = metadata.common.picture?.[0];
    if (coverArt) {
      const coverExt = coverArt.format === 'image/png' ? 'png' : 'jpg';
      coverArtR2Key = `covers/al-${albumId}.${coverExt}`;
      await this.uploader.uploadCoverArt(coverArtR2Key, Buffer.from(coverArt.data), coverArt.format);
    }

    // Sort name for artists (move "The" to end)
    const sortName = computeSortName(artistName);

    // Upsert artist
    await this.db.upsertArtist({
      id: artistId,
      name: artistName,
      sort_name: sortName,
      cover_art_r2_key: coverArtR2Key ? `covers/ar-${artistId}.jpg` : null,
      musicbrainz_id: musicbrainzArtistId,
    });

    // Upload artist cover art (use first album's cover)
    if (coverArt && !this.processedArtists.has(artistId)) {
      const artistCoverKey = `covers/ar-${artistId}.jpg`;
      await this.uploader.uploadCoverArt(artistCoverKey, Buffer.from(coverArt.data), coverArt.format);
    }

    // Upsert album
    await this.db.upsertAlbum({
      id: albumId,
      name: albumName,
      artist_id: artistId,
      artist_name: artistName,
      cover_art_r2_key: coverArtR2Key,
      year,
      genre,
    });

    // Upsert song
    await this.db.upsertSong({
      id: songId,
      title,
      album_id: albumId,
      artist_id: artistId,
      album_name: albumName,
      artist_name: artistName,
      track_number: trackNumber,
      disc_number: discNumber,
      year,
      genre,
      duration,
      bit_rate: bitRate,
      bit_depth: bitDepth,
      sampling_rate: samplingRate,
      channel_count: channelCount,
      file_size: fileBuffer.length,
      content_type: contentType,
      suffix,
      r2_key: r2Key,
      cover_art_r2_key: coverArtR2Key,
      path: virtualPath,
    });

    // Track for aggregate updates
    this.processedAlbums.add(albumId);
    this.processedArtists.add(artistId);
    if (genre) this.genresToUpdate.add(genre);

    return wasUploaded;
  }

  private async findAudioFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    await this.walkDir(dirPath, files);
    return files.sort();
  }

  private async walkDir(dirPath: string, files: string[]): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.walkDir(fullPath, files);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  }
}

async function deterministicId(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  // Format as UUID-like string from first 16 bytes
  const hex = Array.from(bytes.slice(0, 16))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function computeSortName(name: string): string | null {
  const articles = ['the ', 'a ', 'an '];
  const lower = name.toLowerCase();
  for (const article of articles) {
    if (lower.startsWith(article)) {
      return name.slice(article.length) + ', ' + name.slice(0, article.length - 1);
    }
  }
  return null;
}
