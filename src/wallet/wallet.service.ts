import { Injectable } from '@nestjs/common'
import { PrismaService } from '../common/prisma/prisma.service'

@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService) {}

  async getBalance(userId: string) {
    const wallet = await this.prisma.userWallet.findUnique({
      where: { userId },
      select: { balance: true, updatedAt: true },
    })
    return { balance: wallet ? Number(wallet.balance) : 0, updatedAt: wallet?.updatedAt }
  }

  async getTransactions(userId: string, page = 1, limit = 20) {
    const wallet = await this.prisma.userWallet.findUnique({ where: { userId }, select: { id: true } })
    if (!wallet) return { transactions: [], total: 0 }
    const skip = (page - 1) * limit
    const [transactions, total] = await Promise.all([
      this.prisma.userWalletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        skip, take: limit,
      }),
      this.prisma.userWalletTransaction.count({ where: { walletId: wallet.id } }),
    ])
    return { transactions, total, pages: Math.ceil(total / limit), page }
  }

  async initializeTopUp(userId: string, amountNaira: number) {
    if (amountNaira < 100) return { error: 'Minimum top-up is ₦100' }

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
        amount: Math.round(amountNaira * 100),
        metadata: {
          userId,
          type: 'wallet_topup',
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
      amount: amountNaira,
    }
  }

  async verifyTopUp(userId: string, reference: string) {
    const res = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    })
    const data = await res.json()

    if (!data.status || data.data.status !== 'success') {
      return { error: 'Payment verification failed.' }
    }

    const amountNaira = data.data.amount / 100
    const metaUserId = data.data.metadata?.userId

    if (metaUserId && metaUserId !== userId) {
      return { error: 'User mismatch.' }
    }

    const existing = await this.prisma.userWalletTransaction.findFirst({
      where: { description: { contains: reference } },
    })
    if (existing) {
      const w = await this.prisma.userWallet.findUnique({ where: { userId } })
      return { success: true, balance: Number(w?.balance ?? 0), alreadyProcessed: true }
    }

    const wallet = await this.prisma.userWallet.upsert({
      where: { userId },
      create: { userId, balance: amountNaira },
      update: { balance: { increment: amountNaira } },
    })

    await this.prisma.userWalletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: amountNaira,
        type: 'DEPOSIT',
        description: `Paystack top-up · ref:${reference}`,
      },
    })

    return { success: true, balance: Number(wallet.balance) }
  }

  // Direct credit method
  async creditWallet(userId: string, amountKobo: number, reference: string) {
    const amount = amountKobo / 100 // kobo -> naira

    const wallet = await this.prisma.userWallet.upsert({
      where: { userId },
      create: { userId, balance: amount },
      update: { balance: { increment: amount } },
    })

    await this.prisma.userWalletTransaction.create({
      data: {
        walletId: wallet.id,
        amount,
        type: 'DEPOSIT',
        description: `Wallet top-up (ref: ${reference})`,
      },
    })

    return { success: true, newBalance: Number(wallet.balance) }
  }
}

