#!/usr/bin/env bun

import { Command } from 'commander';
import { loadConfig } from './config';
import { D1Client } from './db';
import { R2Uploader } from './uploader';
import { Scanner } from './scanner';

const program = new Command();

program
  .name('music-cli')
  .description('CLI tool for managing CloudflareMusic library')
  .version('0.1.0');

program
  .command('scan <directory>')
  .description('Scan directory for audio files, upload to R2, populate D1 metadata')
  .action(async (directory: string) => {
    const config = loadConfig();
    const db = new D1Client(config);
    const uploader = new R2Uploader(config);
    const scanner = new Scanner(uploader, db);

    console.log(`Scanning: ${directory}\n`);
    const result = await scanner.scanDirectory(directory);

    console.log('\n--- Scan Complete ---');
    console.log(`  Total files:  ${result.total}`);
    console.log(`  Uploaded:     ${result.uploaded}`);
    console.log(`  Skipped:      ${result.skipped}`);
    console.log(`  Errors:       ${result.errors}`);
  });

program
  .command('add <file>')
  .description('Add a single audio file')
  .action(async (file: string) => {
    const config = loadConfig();
    const db = new D1Client(config);
    const uploader = new R2Uploader(config);
    const scanner = new Scanner(uploader, db);

    const wasUploaded = await scanner.processFile(file);
    console.log(wasUploaded ? 'Uploaded successfully' : 'Skipped (already exists)');
  });

program
  .command('stats')
  .description('Show library statistics')
  .action(async () => {
    const config = loadConfig();
    const db = new D1Client(config);

    const stats = await db.getStats();
    console.log('Library Statistics:');
    console.log(`  Artists:  ${stats.artists}`);
    console.log(`  Albums:   ${stats.albums}`);
    console.log(`  Songs:    ${stats.songs}`);
    console.log(`  Genres:   ${stats.genres}`);
    console.log(`  Users:    ${stats.users}`);
  });

program
  .command('user')
  .description('Create a user')
  .requiredOption('--username <username>', 'Username')
  .requiredOption('--password <password>', 'Password (stored as plaintext for Subsonic auth compatibility)')
  .option('--admin', 'Make user an admin', false)
  .action(async (opts: { username: string; password: string; admin: boolean }) => {
    const config = loadConfig();
    const db = new D1Client(config);

    const id = crypto.randomUUID();
    await db.createUser(id, opts.username, opts.password, opts.admin);
    console.log(`User created: ${opts.username} (id: ${id}, admin: ${opts.admin})`);
  });

program
  .command('cleanup')
  .description('Remove "Unknown Artist" duplicate songs from D1 and R2')
  .option('--dry-run', 'Show what would be deleted without actually deleting', false)
  .option('--confirm', 'Required to proceed with actual deletion')
  .action(async (opts: { dryRun: boolean; confirm?: boolean }) => {
    const config = loadConfig();
    const db = new D1Client(config);

    console.log('Finding "Unknown Artist" songs...\n');
    const unknownSongs = await db.findUnknownArtistSongs();

    if (unknownSongs.length === 0) {
      console.log('No "Unknown Artist" songs found. Nothing to clean up.');
      return;
    }

    console.log(`Found ${unknownSongs.length} "Unknown Artist" songs to remove:\n`);
    for (const song of unknownSongs) {
      console.log(`  - ${song.title}`);
      console.log(`    R2: ${song.r2_key}`);
    }

    if (opts.dryRun) {
      console.log('\n[DRY RUN] No changes made. Remove --dry-run and add --confirm to delete.');
      return;
    }

    if (!opts.confirm) {
      console.log('\nThis will DELETE these songs from D1 and R2. Pass --confirm to proceed.');
      return;
    }

    const uploader = new R2Uploader(config);
    let deletedSongs = 0;
    let deletedR2 = 0;
    let deletedAlbums = 0;
    let deletedArtists = 0;
    const albumIds = new Set<string>();
    const artistIds = new Set<string>();

    for (const song of unknownSongs) {
      albumIds.add(song.album_id);
      artistIds.add(song.artist_id);

      // Delete audio file from R2
      try {
        await uploader.delete(song.r2_key);
        deletedR2++;
        console.log(`  Deleted R2: ${song.r2_key}`);
      } catch (err) {
        console.error(`  Failed to delete R2 key ${song.r2_key}: ${err}`);
      }

      // Delete cover art from R2 if present
      if (song.cover_art_r2_key) {
        try {
          await uploader.delete(song.cover_art_r2_key);
          console.log(`  Deleted R2: ${song.cover_art_r2_key}`);
        } catch {
          // Cover art might be shared or already deleted, ignore
        }
      }

      // Delete song from D1
      await db.deleteSong(song.id);
      deletedSongs++;
    }

    // Clean up empty albums
    for (const albumId of albumIds) {
      const deleted = await db.deleteAlbumIfEmpty(albumId);
      if (deleted) deletedAlbums++;
    }

    // Clean up empty artists
    for (const artistId of artistIds) {
      const deleted = await db.deleteArtistIfEmpty(artistId);
      if (deleted) deletedArtists++;
    }

    // Update genre counts
    await db.execute(
      `UPDATE genres SET
        song_count = (SELECT COUNT(*) FROM songs WHERE genre = genres.name),
        album_count = (SELECT COUNT(DISTINCT album_id) FROM songs WHERE genre = genres.name)`
    );
    // Remove genres with zero songs
    await db.execute('DELETE FROM genres WHERE song_count = 0');

    console.log('\n--- Cleanup Complete ---');
    console.log(`  Songs deleted:   ${deletedSongs}`);
    console.log(`  R2 files deleted: ${deletedR2}`);
    console.log(`  Albums deleted:  ${deletedAlbums}`);
    console.log(`  Artists deleted: ${deletedArtists}`);
  });

program
  .command('nuke')
  .description('Delete ALL data from D1 (does not delete R2 files)')
  .option('--confirm', 'Required to proceed')
  .action(async (opts: { confirm?: boolean }) => {
    if (!opts.confirm) {
      console.error('This will DELETE ALL DATA from D1. Pass --confirm to proceed.');
      process.exit(1);
    }

    const config = loadConfig();
    const db = new D1Client(config);

    console.log('Deleting all data from D1...');
    await db.nukeAll();
    console.log('Done. All D1 tables have been cleared.');
  });

program.parse();
