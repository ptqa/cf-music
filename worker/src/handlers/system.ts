import { type Env, type AuthenticatedRequest } from '../types';
import { subsonicResponse } from '../response';

export async function handleSystem(endpoint: string, ctx: AuthenticatedRequest, _env: Env): Promise<Response> {
  switch (endpoint) {
    case 'ping':
      return subsonicResponse(ctx.format);

    case 'getLicense':
      return subsonicResponse(ctx.format, {
        license: { valid: true, email: 'user@example.com' },
      });

    case 'getUser':
      return subsonicResponse(ctx.format, {
        user: {
          username: ctx.user.username,
          email: '',
          scrobblingEnabled: true,
          adminRole: ctx.user.is_admin === 1,
          settingsRole: true,
          downloadRole: true,
          uploadRole: false,
          playlistRole: true,
          coverArtRole: false,
          commentRole: false,
          podcastRole: false,
          streamRole: true,
          jukeboxRole: false,
          shareRole: false,
          videoConversionRole: false,
          folder: [0],
        },
      });

    case 'getUsers':
      // Only admins
      if (ctx.user.is_admin !== 1) {
        return subsonicResponse(ctx.format, {
          error: { code: 50, message: 'User is not authorized for the given operation' },
        });
      }
      return subsonicResponse(ctx.format, {
        users: {
          user: [{
            username: ctx.user.username,
            adminRole: ctx.user.is_admin === 1,
            streamRole: true,
            downloadRole: true,
            playlistRole: true,
          }],
        },
      });

    default:
      return subsonicResponse(ctx.format);
  }
}
