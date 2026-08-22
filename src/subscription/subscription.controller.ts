import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { SubscriptionService } from './subscription.service'

@Controller('subscription')
@UseGuards(JwtAuthGuard)
export class SubscriptionController {
  constructor(private sub: SubscriptionService) {}
  @Get('my') mySubscriptions(@CurrentUser() u: any) { return this.sub.getMySubscriptions(u.id) }
  @Get('plans/:creatorId') getPlans(@Param('creatorId') id: string) { return this.sub.getPlans(id) }
}
