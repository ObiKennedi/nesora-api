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

  // ── NESORA Plus Platform Membership (₦5,000 / month) ──
  async getMembershipStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
      },
    })
    if (!user) return { isPaidMember: false }

    // Check active platform subscription or valid transaction
    const activeSub = await this.prisma.userWalletTransaction.findFirst({
      where: {
        wallet: { userId },
        description: { contains: 'NESORA Plus' },
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    })

    const isPaid = !!activeSub
    const expiresAt = activeSub
      ? new Date(activeSub.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000)
      : null

    return {
      isPaidMember: isPaid,
      expiresAt,
      price: 5000,
      interval: 'monthly',
      planName: 'NESORA Plus Membership',
    }
  }

  async initializeMembership(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true, lastName: true },
    })
    if (!user) return { error: 'User not found.' }

    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: user.email,
        amount: 500000, // ₦5,000 in kobo
        metadata: {
          userId,
          type: 'membership_subscription',
          planName: 'NESORA Plus (₦5,000/mo)',
        },
      }),
    })

    const data = await res.json()
    if (!data.status) return { error: data.message || 'Failed to initialize payment.' }

    return {
      success: true,
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
      reference: data.data.reference,
      amount: 5000,
    }
  }

  async verifyMembership(userId: string, reference: string) {
    const res = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    })
    const data = await res.json()

    if (!data.status || data.data.status !== 'success') {
      return { error: 'Payment verification failed.' }
    }

    const wallet = await this.prisma.userWallet.upsert({
      where: { userId },
      create: { userId, balance: 0 },
      update: {},
    })

    await this.prisma.userWalletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: 5000,
        type: 'SUBSCRIPTION_PAYMENT',
        description: `NESORA Plus (₦5,000/mo) · ref:${reference}`,
      },
    })

    return {
      success: true,
      isPaidMember: true,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    }
  }

  // ── Creator Subscription Plans Management ──

  async getCreatorPlans(userId: string) {
    const creator = await this.prisma.creator.findUnique({ where: { userId } })
    if (!creator) return []

    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { creatorId: creator.id },
      orderBy: { price: 'asc' },
      include: {
        _count: {
          select: {
            subscriptions: {
              where: { status: 'ACTIVE' },
            },
          },
        },
      },
    })

    return plans.map((p) => ({
      ...p,
      price: Number(p.price),
      activeSubscribersCount: p._count.subscriptions,
    }))
  }

  async createCreatorPlan(userId: string, data: {
    name: string
    description?: string
    price: number
    interval?: 'monthly' | 'yearly'
    benefits?: string[]
  }) {
    let creator = await this.prisma.creator.findUnique({ where: { userId } })
    if (!creator) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } })
      creator = await this.prisma.creator.create({
        data: {
          userId,
          displayName: user?.name || 'Creator',
          handle: user?.username || `creator_${Date.now()}`,
          subscriptionEnabled: true,
        },
      })
    } else if (!creator.subscriptionEnabled) {
      await this.prisma.creator.update({
        where: { id: creator.id },
        data: { subscriptionEnabled: true },
      })
    }

    const count = await this.prisma.subscriptionPlan.count({
      where: { creatorId: creator.id },
    })
    if (count >= 5) {
      return { error: 'You can create a maximum of 5 subscription tiers.' }
    }

    const plan = await this.prisma.subscriptionPlan.create({
      data: {
        creatorId: creator.id,
        name: data.name,
        description: data.description || '',
        price: data.price,
        interval: data.interval || 'monthly',
        benefits: data.benefits && data.benefits.length > 0
          ? data.benefits
          : ['Exclusive subscriber posts', 'Direct 1-on-1 messaging'],
      },
    })

    return { success: true, plan }
  }

  async updateCreatorPlan(userId: string, planId: string, data: {
    name?: string
    description?: string
    price?: number
    interval?: 'monthly' | 'yearly'
    benefits?: string[]
  }) {
    const creator = await this.prisma.creator.findUnique({ where: { userId } })
    if (!creator) return { error: 'Creator not found.' }

    const plan = await this.prisma.subscriptionPlan.findFirst({
      where: { id: planId, creatorId: creator.id },
    })
    if (!plan) return { error: 'Plan not found.' }

    const updated = await this.prisma.subscriptionPlan.update({
      where: { id: planId },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.price !== undefined ? { price: data.price } : {}),
        ...(data.interval ? { interval: data.interval } : {}),
        ...(data.benefits ? { benefits: data.benefits } : {}),
      },
    })

    return { success: true, plan: updated }
  }

  async toggleCreatorPlan(userId: string, planId: string) {
    const creator = await this.prisma.creator.findUnique({ where: { userId } })
    if (!creator) return { error: 'Creator not found.' }

    const plan = await this.prisma.subscriptionPlan.findFirst({
      where: { id: planId, creatorId: creator.id },
    })
    if (!plan) return { error: 'Plan not found.' }

    const updated = await this.prisma.subscriptionPlan.update({
      where: { id: planId },
      data: { isActive: !plan.isActive },
    })

    return { success: true, isActive: updated.isActive }
  }

  async deleteCreatorPlan(userId: string, planId: string) {
    const creator = await this.prisma.creator.findUnique({ where: { userId } })
    if (!creator) return { error: 'Creator not found.' }

    const plan = await this.prisma.subscriptionPlan.findFirst({
      where: { id: planId, creatorId: creator.id },
    })
    if (!plan) return { error: 'Plan not found.' }

    const activeCount = await this.prisma.subscription.count({
      where: { subscriptionPlanId: planId, status: 'ACTIVE' },
    })
    if (activeCount > 0) {
      return {
        error: `Cannot delete plan with ${activeCount} active subscriber(s). You can pause it instead.`,
      }
    }

    await this.prisma.subscriptionPlan.delete({ where: { id: planId } })
    return { success: true }
  }
}


