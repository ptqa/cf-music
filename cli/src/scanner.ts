/**
 * Music directory scanner.
 * Reads ID3 tags, extracts cover art, generates deterministic IDs.
 */

import { readdir, stat, readFile } from 'fs/promises';
import { join, extname, basename } from 'path';
import { parseBuffer, type IAudioMetadata } from 'music-metadata';
import { type R2Uploader } from './uploader';
import { type D1Client } from './db';

// Windows-1251 decoding table (0x80-0xFF)
const WIN1251_MAP: Record<number, string> = {
  0x80:'\u0402',0x81:'\u0403',0x82:'\u201A',0x83:'\u0453',0x84:'\u201E',0x85:'\u2026',0x86:'\u2020',0x87:'\u2021',
  0x88:'\u20AC',0x89:'\u2030',0x8A:'\u0409',0x8B:'\u2039',0x8C:'\u040A',0x8D:'\u040C',0x8E:'\u040B',0x8F:'\u040F',
  0x90:'\u0452',0x91:'\u2018',0x92:'\u2019',0x93:'\u201C',0x94:'\u201D',0x95:'\u2022',0x96:'\u2013',0x97:'\u2014',
  0x98:'\u0098',0x99:'\u2122',0x9A:'\u0459',0x9B:'\u203A',0x9C:'\u045A',0x9D:'\u045C',0x9E:'\u045B',0x9F:'\u045F',
  0xA0:'\u00A0',0xA1:'\u040E',0xA2:'\u045E',0xA3:'\u0408',0xA4:'\u00A4',0xA5:'\u0490',0xA6:'\u00A6',0xA7:'\u00A7',
  0xA8:'\u0401',0xA9:'\u00A9',0xAA:'\u0404',0xAB:'\u00AB',0xAC:'\u00AC',0xAD:'\u00AD',0xAE:'\u00AE',0xAF:'\u0407',
  0xB0:'\u00B0',0xB1:'\u00B1',0xB2:'\u0406',0xB3:'\u0456',0xB4:'\u0491',0xB5:'\u00B5',0xB6:'\u00B6',0xB7:'\u00B7',
  0xB8:'\u0451',0xB9:'\u2116',0xBA:'\u0454',0xBB:'\u00BB',0xBC:'\u0458',0xBD:'\u0405',0xBE:'\u0455',0xBF:'\u0457',
  0xC0:'\u0410',0xC1:'\u0411',0xC2:'\u0412',0xC3:'\u0413',0xC4:'\u0414',0xC5:'\u0415',0xC6:'\u0416',0xC7:'\u0417',
  0xC8:'\u0418',0xC9:'\u0419',0xCA:'\u041A',0xCB:'\u041B',0xCC:'\u041C',0xCD:'\u041D',0xCE:'\u041E',0xCF:'\u041F',
  0xD0:'\u0420',0xD1:'\u0421',0xD2:'\u0422',0xD3:'\u0423',0xD4:'\u0424',0xD5:'\u0425',0xD6:'\u0426',0xD7:'\u0427',
  0xD8:'\u0428',0xD9:'\u0429',0xDA:'\u042A',0xDB:'\u042B',0xDC:'\u042C',0xDD:'\u042D',0xDE:'\u042E',0xDF:'\u042F',
  0xE0:'\u0430',0xE1:'\u0431',0xE2:'\u0432',0xE3:'\u0433',0xE4:'\u0434',0xE5:'\u0435',0xE6:'\u0436',0xE7:'\u0437',
  0xE8:'\u0438',0xE9:'\u0439',0xEA:'\u043A',0xEB:'\u043B',0xEC:'\u043C',0xED:'\u043D',0xEE:'\u043E',0xEF:'\u043F',
  0xF0:'\u0440',0xF1:'\u0441',0xF2:'\u0442',0xF3:'\u0443',0xF4:'\u0444',0xF5:'\u0445',0xF6:'\u0446',0xF7:'\u0447',
  0xF8:'\u0448',0xF9:'\u0449',0xFA:'\u044A',0xFB:'\u044B',0xFC:'\u044C',0xFD:'\u044D',0xFE:'\u044E',0xFF:'\u044F',
};

/**
 * Detect if a string looks like Windows-1251 bytes misread as Latin-1.
 * Heuristic: if most chars in the 0x80-0xFF range map to Cyrillic (0xC0-0xFF in cp1251),
 * it's almost certainly a mis-decoded Windows-1251 string.
 */
function looksLikeMisdecodedWin1251(str: string): boolean {
  let highByteCount = 0;
  let cyrillicRangeCount = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0x80 && code <= 0xFF) {
      highByteCount++;
      if (code >= 0xC0 && code <= 0xFF) {
        cyrillicRangeCount++;
      }
    }
  }
  // If we have high-byte characters and most of them are in the Cyrillic range of cp1251
  return highByteCount >= 2 && cyrillicRangeCount / highByteCount > 0.5;
}

/**
 * Re-decode a string that was incorrectly read as Latin-1 but is actually Windows-1251.
 */
function decodeWin1251(str: string): string {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0x80 && code <= 0xFF && WIN1251_MAP[code]) {
      result += WIN1251_MAP[code];
    } else {
      result += str[i];
    }
  }
  return result;
}

/**
 * Fix string encoding if it looks like mis-decoded Windows-1251.
 */
function fixEncoding(str: string | undefined): string | undefined {
  if (!str) return str;
  if (looksLikeMisdecodedWin1251(str)) {
    return decodeWin1251(str);
  }
  return str;
}

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

    const artistName = fixEncoding(metadata.common.artist || metadata.common.albumartist) || 'Unknown Artist';
    const albumName = fixEncoding(metadata.common.album) || 'Unknown Album';
    const title = fixEncoding(metadata.common.title) || basename(filePath, ext);
    const trackNumber = metadata.common.track?.no || null;
    const discNumber = metadata.common.disk?.no || 1;
    const year = metadata.common.year || null;
    const genre = fixEncoding(metadata.common.genre?.[0]) || null;
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
