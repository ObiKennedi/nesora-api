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

  // Paystack server-side top-up: caller verifies payment ref with Paystack API,
  // then credits the wallet. Mobile app should verify first, then call this.
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
