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
}

