import { Injectable } from '@nestjs/common'
import { PrismaService } from '../common/prisma/prisma.service'
import { PushService } from '../push/push.service'

@Injectable()
export class SubscriptionService {
  constructor(private prisma: PrismaService, private push: PushService) {}

  async getPlans(creatorId: string) {
    return this.prisma.subscriptionPlan.findMany({
      where: { creatorId, isActive: true },
      orderBy: { price: 'asc' },
    })
  }

  async getMySubscriptions(userId: string) {
    return this.prisma.subscription.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { creator: { select: { id: true, displayName: true, handle: true, user: { select: { image: true } } } } },
    })
  }
}
