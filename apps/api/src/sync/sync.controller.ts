import {
  syncPullRequestSchema,
  syncPushRequestSchema,
  type SyncPullResponse,
  type SyncPushResponse,
} from '@ironlog/shared';
import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';

import { AuthGuard, type AuthedRequest } from '../auth/auth.guard.js';

import { SyncService } from './sync.service.js';

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

  /** Downloads everything changed since the client's cursor. */
  @Post('pull')
  async pull(@Req() request: AuthedRequest, @Body() body: unknown): Promise<SyncPullResponse> {
    const parsed = syncPullRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    return this.sync.pull(request.userId, parsed.data.cursor, parsed.data.limit);
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
