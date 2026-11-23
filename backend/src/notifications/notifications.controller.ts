import {BadRequestException, CanActivate, Controller, Delete, ExecutionContext, Get, HttpCode, Inject, Injectable, Param, Patch, Post, Query, Req, UseGuards} from '@nestjs/common';
import {Throttle} from '@nestjs/throttler';
import {CustomerGuard, type CustomerPrincipal} from '../account-auth';
import {SESSION_COOKIE} from '../account-core';
import {AuthGuard} from '../core';
import {ValidatedBody} from '../validation';
import {EndpointDto, NotificationService, type Owner, SubscribeDto} from './notifications.service';

type NotificationRequest = {headers: Record<string, string | undefined>; cookies?: Record<string, string>; user?: {id: string}; customer?: CustomerPrincipal; notificationOwner: Owner};

@Injectable()
export class NotificationGuard implements CanActivate {
  constructor(@Inject(AuthGuard) private readonly staff: AuthGuard, @Inject(CustomerGuard) private readonly account: CustomerGuard) {}
  async canActivate(ctx: ExecutionContext) {
    const http = ctx.switchToHttp();
    const req = http.getRequest<NotificationRequest>();
    const res = http.getResponse();
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('X-Robots-Tag', 'noindex');
    const audience = req.headers['x-wsj-audience'];
    if (audience !== undefined && audience !== 'staff' && audience !== 'customer') throw new BadRequestException('Invalid notification audience');
    const staff = audience === 'staff' || (audience === undefined && (req.headers.authorization?.startsWith('Bearer ') || !req.cookies?.[SESSION_COOKIE]));
    if (staff) {
      await this.staff.canActivate(ctx);
      req.notificationOwner = {userId: req.user!.id};
    } else {
      await this.account.canActivate(ctx);
      req.notificationOwner = {customerId: req.customer!.id};
    }
    return true;
  }
}

@Controller('notifications')
@UseGuards(NotificationGuard)
export class NotificationsController {
  constructor(@Inject(NotificationService) private readonly notifications: NotificationService) {}

  @Get('vapid-key') vapid() { return {publicKey: this.notifications.publicKey()}; }

  @Post('push-subscribe') @HttpCode(200) @Throttle({default: {limit: 20, ttl: 60000}})
  subscribe(@Req() req: NotificationRequest, @ValidatedBody(SubscribeDto) dto: SubscribeDto) { return this.notifications.subscribe(req.notificationOwner, dto, req.headers['user-agent']); }

  @Post('push-status') @HttpCode(200)
  status(@Req() req: NotificationRequest, @ValidatedBody(EndpointDto) dto: EndpointDto) { return this.notifications.status(req.notificationOwner, dto.endpoint); }

  @Delete('push-unsubscribe') @HttpCode(200)
  unsubscribe(@Req() req: NotificationRequest, @ValidatedBody(EndpointDto) dto: EndpointDto) { return this.notifications.unsubscribe(req.notificationOwner, dto.endpoint); }

  @Post('push-unsubscribe') @HttpCode(200)
  unsubscribePost(@Req() req: NotificationRequest, @ValidatedBody(EndpointDto) dto: EndpointDto) { return this.unsubscribe(req, dto); }

  @Get('in-app') list(@Req() req: NotificationRequest, @Query() query: {page?: string; limit?: string}) { return this.notifications.list(req.notificationOwner, query); }

  @Post('read-all') @HttpCode(200) readAll(@Req() req: NotificationRequest) { return this.notifications.readAll(req.notificationOwner); }
  @Patch('read-all') readAllPatch(@Req() req: NotificationRequest) { return this.readAll(req); }
  @Patch(':id/read') read(@Req() req: NotificationRequest, @Param('id') id: string) { return this.notifications.read(req.notificationOwner, id); }
}

