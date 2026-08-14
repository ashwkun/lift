import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { auth } from './auth.js';

/** Request augmented with the resolved session, set by {@link AuthGuard}. */
export interface AuthedRequest extends Request {
  userId: string;
}

/**
 * Converts Node's header bag into the web `Headers` better-auth expects.
 * Array-valued headers are joined, matching how Node would have sent them.
 */
function toWebHeaders(request: Request): Headers {
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }

  return headers;
}

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();

    const session = await auth.api.getSession({ headers: toWebHeaders(request) });

    if (!session?.user?.id) {
      throw new UnauthorizedException('Sign in to sync.');
    }

    // Every downstream query scopes by this; it is never taken from the body.
    request.userId = session.user.id;
    return true;
  }
}
