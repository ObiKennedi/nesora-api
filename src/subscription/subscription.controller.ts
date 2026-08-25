import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { SubscriptionService } from './subscription.service'

@Controller('subscription')
@UseGuards(JwtAuthGuard)
export class SubscriptionController {
  constructor(private sub: SubscriptionService) {}

  @Get('my')
  mySubscriptions(@CurrentUser() u: any) {
    return this.sub.getMySubscriptions(u.id)
  }

  @Get('plans/:creatorId')
  getPlans(@Param('creatorId') id: string) {
    return this.sub.getPlans(id)
  }

  @Get('membership/status')
  getMembershipStatus(@CurrentUser() u: any) {
    return this.sub.getMembershipStatus(u.id)
  }

  @Post('membership/initialize')
  initializeMembership(@CurrentUser() u: any) {
    return this.sub.initializeMembership(u.id)
  }

  @Get('creator/plans')
  getCreatorPlans(@CurrentUser() u: any) {
    return this.sub.getCreatorPlans(u.id)
  }

  @Post('creator/plans')
  createCreatorPlan(
    @CurrentUser() u: any,
    @Body()
    dto: {
      name: string
      description?: string
      price: number
      interval?: 'monthly' | 'yearly'
      benefits?: string[]
    },
  ) {
    return this.sub.createCreatorPlan(u.id, dto)
  }

  @Post('creator/plans/:id/toggle')
  toggleCreatorPlan(@CurrentUser() u: any, @Param('id') id: string) {
    return this.sub.toggleCreatorPlan(u.id, id)
  }

  @Post('creator/plans/:id/update')
  updateCreatorPlan(
    @CurrentUser() u: any,
    @Param('id') id: string,
    @Body()
    dto: {
      name?: string
      description?: string
      price?: number
      interval?: 'monthly' | 'yearly'
      benefits?: string[]
    },
  ) {
    return this.sub.updateCreatorPlan(u.id, id, dto)
  }

  @Post('creator/plans/:id/delete')
  deleteCreatorPlan(@CurrentUser() u: any, @Param('id') id: string) {
    return this.sub.deleteCreatorPlan(u.id, id)
  }
}


