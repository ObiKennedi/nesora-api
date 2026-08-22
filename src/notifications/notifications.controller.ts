import { Controller, Get, Patch, Param, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { NotificationsService } from './notifications.service'

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private notif: NotificationsService) {}
  @Get() get(@CurrentUser() u: any, @Query('page') p?: string) { return this.notif.getNotifications(u.id, Number(p ?? 1)) }
  @Patch(':id/read') read(@CurrentUser() u: any, @Param('id') id: string) { return this.notif.markRead(u.id, id) }
  @Patch('read-all') readAll(@CurrentUser() u: any) { return this.notif.markAllRead(u.id) }
}
