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

  // ── Creator Bank Accounts & Payouts ──────────────────────────────────────────

  async getCreatorBankAccounts(userId: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId },
      select: { id: true },
    })
    if (!creator) return []

    return this.prisma.bankAccount.findMany({
      where: { creatorId: creator.id },
      orderBy: { isDefault: 'desc' },
    })
  }

  async addCreatorBankAccount(userId: string, data: {
    bankName: string
    accountName: string
    accountNumber: string
    bankCode?: string
  }) {
    if (!data.bankName || !data.accountName || !data.accountNumber) {
      return { error: 'Bank name, account name, and account number are required.' }
    }

    if (data.accountNumber.length !== 10) {
      return { error: 'Account number must be 10 digits.' }
    }

    let creator = await this.prisma.creator.findUnique({
      where: { userId },
      select: { id: true },
    })

    if (!creator) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } })
      creator = await this.prisma.creator.create({
        data: {
          userId,
          displayName: user?.name || 'Creator',
          handle: user?.username || `creator_${Date.now()}`,
        },
        select: { id: true },
      })
    }

    const count = await this.prisma.bankAccount.count({
      where: { creatorId: creator.id },
    })

    const account = await this.prisma.bankAccount.create({
      data: {
        creatorId: creator.id,
        bankName: data.bankName,
        accountName: data.accountName,
        accountNumber: data.accountNumber,
        bankCode: data.bankCode || '000',
        isDefault: count === 0,
      },
    })

    return { success: true, account }
  }

  async setDefaultCreatorBankAccount(userId: string, accountId: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId },
      select: { id: true },
    })
    if (!creator) return { error: 'Creator not found.' }

    await this.prisma.$transaction([
      this.prisma.bankAccount.updateMany({
        where: { creatorId: creator.id },
        data: { isDefault: false },
      }),
      this.prisma.bankAccount.update({
        where: { id: accountId, creatorId: creator.id },
        data: { isDefault: true },
      }),
    ])

    return { success: true }
  }

  async deleteCreatorBankAccount(userId: string, accountId: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId },
      select: { id: true },
    })
    if (!creator) return { error: 'Creator not found.' }

    const account = await this.prisma.bankAccount.findFirst({
      where: { id: accountId, creatorId: creator.id },
    })
    if (!account) return { error: 'Bank account not found.' }

    await this.prisma.bankAccount.delete({
      where: { id: accountId },
    })

    return { success: true }
  }

  async getCreatorWalletBalance(userId: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId },
      include: {
        wallet: true,
        bankAccounts: { where: { isDefault: true }, take: 1 },
      },
    })

    if (!creator) {
      return {
        balance: 0,
        defaultBank: null,
        pendingPayouts: 0,
      }
    }

    const pendingWithdrawals = await this.prisma.withdrawal.aggregate({
      where: { creatorId: creator.id, status: 'PENDING' },
      _sum: { netAmount: true },
    })

    return {
      balance: creator.wallet ? Number(creator.wallet.balance) : 0,
      defaultBank: creator.bankAccounts[0] || null,
      pendingPayouts: Number(pendingWithdrawals._sum.netAmount || 0),
    }
  }

  async requestCreatorPayout(userId: string, amountNaira: number, bankAccountId?: string) {
    if (amountNaira < 1000) {
      return { error: 'Minimum payout request is ₦1,000.' }
    }

    const creator = await this.prisma.creator.findUnique({
      where: { userId },
      include: {
        wallet: true,
        bankAccounts: true,
      },
    })

    if (!creator) return { error: 'Creator profile not found.' }

    const targetBank = bankAccountId
      ? creator.bankAccounts.find((b) => b.id === bankAccountId)
      : creator.bankAccounts.find((b) => b.isDefault) || creator.bankAccounts[0]

    if (!targetBank) {
      return { error: 'Please add a bank account first to receive payouts.' }
    }

    const grossAmount = amountNaira
    const platformFee = Math.round((grossAmount * 10) / 100)
    const netAmount = grossAmount - platformFee

    const walletBalance = creator.wallet ? Number(creator.wallet.balance) : 0
    if (walletBalance < grossAmount) {
      return { error: `Insufficient earnings balance (Available: ₦${walletBalance.toLocaleString()}).` }
    }

    const withdrawal = await this.prisma.$transaction(async (tx) => {
      // Deduct balance
      await tx.creatorWallet.update({
        where: { id: creator.wallet!.id },
        data: { balance: { decrement: grossAmount } },
      })

      // Create withdrawal record
      const w = await tx.withdrawal.create({
        data: {
          creatorId: creator.id,
          bankAccountId: targetBank.id,
          grossAmount,
          platformFee,
          netAmount,
          status: 'PENDING',
        },
      })

      // Create wallet transaction
      await tx.creatorWalletTransaction.create({
        data: {
          walletId: creator.wallet!.id,
          amount: grossAmount,
          type: 'WITHDRAWAL',
          description: `Payout to ${targetBank.bankName} (${targetBank.accountNumber})`,
        },
      })

      return w
    })

    return {
      success: true,
      withdrawalId: withdrawal.id,
      netAmount,
      grossAmount,
      status: 'PENDING',
    }
  }

  async getCreatorPayouts(userId: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId },
      select: { id: true },
    })
    if (!creator) return []

    return this.prisma.withdrawal.findMany({
      where: { creatorId: creator.id },
      orderBy: { createdAt: 'desc' },
      include: {
        bankAccount: {
          select: { bankName: true, accountNumber: true, accountName: true },
        },
      },
    })
  }
}


