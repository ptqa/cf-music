import { type Env, type AuthenticatedRequest } from './types';
import { authenticate } from './auth';
import { subsonicError } from './response';
import { handleSystem } from './handlers/system';
import { handleBrowsing } from './handlers/browsing';
import { handleLists } from './handlers/lists';
import { handleSearch } from './handlers/search';
import { handleMedia } from './handlers/media';
import { handleAnnotation } from './handlers/annotation';
import { handlePlaylists } from './handlers/playlists';
import { handleBookmarks } from './handlers/bookmarks';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === '/' || path === '/health') {
      return new Response(JSON.stringify({ status: 'ok', server: env.SERVER_NAME, version: env.SERVER_VERSION }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // All Subsonic endpoints live under /rest/
    if (!path.startsWith('/rest/')) {
      return new Response('Not Found', { status: 404 });
    }

    // Extract endpoint name: strip /rest/ prefix and optional .view suffix
    let endpoint = path.slice(6); // remove "/rest/"
    if (endpoint.endsWith('.view')) {
      endpoint = endpoint.slice(0, -5);
    }
    // Remove trailing slash
    if (endpoint.endsWith('/')) {
      endpoint = endpoint.slice(0, -1);
    }

    // Parse all query params
    const params: Record<string, string> = {};
    for (const [key, value] of url.searchParams) {
      params[key] = value;
    }

    // Also parse POST form body if present
    if (request.method === 'POST') {
      const contentType = request.headers.get('Content-Type') || '';
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const body = await request.text();
        const formParams = new URLSearchParams(body);
        for (const [key, value] of formParams) {
          params[key] = value;
        }
      }
    }

    const format = (params.f === 'json' || params.f === 'jsonp') ? 'json' : 'xml';

    // Authenticate
    const authResult = await authenticate(env.DB, params);
    if (!authResult.ok) {
      return subsonicError(format, 40, authResult.error || 'Wrong username or password');
    }

    const ctx: AuthenticatedRequest = {
      user: authResult.user!,
      params,
      format,
      request,
    };

    try {
      // Route to handler
      const response = await routeRequest(endpoint, ctx, env);
      if (response) return response;

      return subsonicError(format, 0, 'Requested endpoint is not supported');
    } catch (err) {
      console.error(`Error handling ${endpoint}:`, err);
      return subsonicError(format, 0, 'Internal server error');
    }
  },
};

async function routeRequest(endpoint: string, ctx: AuthenticatedRequest, env: Env): Promise<Response | null> {
  // System
  switch (endpoint) {
    case 'ping':
    case 'getLicense':
    case 'getUser':
    case 'getUsers':
      return handleSystem(endpoint, ctx, env);
  }

  // Browsing
  switch (endpoint) {
    case 'getMusicFolders':
    case 'getIndexes':
    case 'getMusicDirectory':
    case 'getArtists':
    case 'getArtist':
    case 'getArtistInfo':
    case 'getArtistInfo2':
    case 'getAlbum':
    case 'getSong':
    case 'getGenres':
      return handleBrowsing(endpoint, ctx, env);
  }

  // Lists
  switch (endpoint) {
    case 'getAlbumList':
    case 'getAlbumList2':
    case 'getRandomSongs':
    case 'getSongsByGenre':
    case 'getNowPlaying':
      return handleLists(endpoint, ctx, env);
  }

  // Search
  switch (endpoint) {
    case 'search2':
    case 'search3':
      return handleSearch(endpoint, ctx, env);
  }

  // Media
  switch (endpoint) {
    case 'stream':
    case 'download':
    case 'getCoverArt':
      return handleMedia(endpoint, ctx, env);
  }

  // Annotation
  switch (endpoint) {
    case 'star':
    case 'unstar':
    case 'getStarred':
    case 'getStarred2':
    case 'setRating':
    case 'scrobble':
      return handleAnnotation(endpoint, ctx, env);
  }

  // Playlists
  switch (endpoint) {
    case 'getPlaylists':
    case 'getPlaylist':
    case 'createPlaylist':
    case 'updatePlaylist':
    case 'deletePlaylist':
      return handlePlaylists(endpoint, ctx, env);
  }

  // Bookmarks / Play queue
  switch (endpoint) {
    case 'savePlayQueue':
    case 'getPlayQueue':
      return handleBookmarks(endpoint, ctx, env);
  }

  return null;
}
