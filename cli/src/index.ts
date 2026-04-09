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
