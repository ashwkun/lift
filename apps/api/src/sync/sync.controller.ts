import {
  syncPullRequestSchema,
  syncPushRequestSchema,
  type SyncPushResponse,
} from '@lift/shared';
import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { AuthGuard, type AuthedRequest } from '../auth/auth.guard.js';

import {
  SyncService,
  type SyncPullResponseWithWatermark,
  type TombstoneSweep,
} from './sync.service.js';

/**
 * How long tombstones must be kept, in days, for one sweep.
 *
 * Optional: left out, the service's own retention applies. It is a request
 * field rather than deployment config because a sweep is an explicit act by
 * whoever asks for one, and the horizon is the whole risk in it. Nothing in the
 * app sends this.
 */
const sweepRequestSchema = z.object({
  retainForDays: z.number().min(0).max(3650).optional(),
});

@Controller('sync')
@UseGuards(AuthGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /**
   * Uploads local mutations.
   *
   * Safe to retry: mutations already recorded for this (device, clientSeq) are
   * acknowledged without being re-applied.
   */
  @Post('push')
  async push(@Req() request: AuthedRequest, @Body() body: unknown): Promise<SyncPushResponse> {
    const parsed = syncPushRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    return this.sync.push(request.userId, parsed.data.deviceId, parsed.data.mutations);
  }

  /**
   * Downloads everything changed since the client's cursor.
   *
   * The response carries one key beyond the shared schema, `resyncRequired`.
   * See `SyncService.pull` for why it is safe to send to a client that has
   * never heard of it, and `purgeTombstones` for what it is unable to do for
   * that client.
   */
  @Post('pull')
  async pull(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): Promise<SyncPullResponseWithWatermark> {
    const parsed = syncPullRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    return this.sync.pull(request.userId, parsed.data.cursor, parsed.data.limit);
  }

  /**
   * Runs a tombstone sweep over the caller's own account.
   *
   * Deliberately request-driven and deliberately self-scoped. Purging a
   * tombstone is the one operation here that can lose information for a device
   * that has not synced recently, so it does not run on a timer and there is no
   * way to ask for it on somebody else's data. No shipped client calls this,
   * which is what keeps the behaviour of every existing install unchanged.
   *
   * A scheduled sweep is the goal, and what it is waiting for is not this code:
   * it is a protocol that can tell an out-of-date device to resync and be
   * understood. The watermark this maintains is the half of that which can be
   * built now.
   */
  @Post('gc')
  async gc(@Req() request: AuthedRequest, @Body() body: unknown): Promise<TombstoneSweep> {
    const parsed = sweepRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    const { retainForDays } = parsed.data;

    return this.sync.purgeTombstones(
      request.userId,
      retainForDays === undefined ? undefined : retainForDays * 24 * 60 * 60 * 1000,
    );
  }

  /** Lets a client check how far behind it is without transferring rows. */
  @Get('status')
  async status(@Req() request: AuthedRequest) {
    return {
      cursor: await this.sync.latestCursor(request.userId),
      serverTime: Date.now(),
    };
  }
}
