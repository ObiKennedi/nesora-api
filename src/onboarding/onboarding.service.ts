import { Injectable } from '@nestjs/common'
import { PrismaService } from '../common/prisma/prisma.service'
import { OnboardingType } from '@prisma/client'

@Injectable()
export class OnboardingService {
  constructor(private prisma: PrismaService) {}

  async selectType(userId: string, type: OnboardingType) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { onboardingType: type },
    })
    if (type === 'CREATOR') {
      const existing = await this.prisma.creator.findUnique({ where: { userId } })
      if (!existing) {
        await this.prisma.creator.create({
          data: { userId, displayName: user.name, handle: user.username ?? undefined },
        })
      }
    }
    return { success: true, onboardingType: type }
  }

  async setUsername(userId: string, username: string) {
    const reserved = ['admin','root','nesora','support','help','api','www','app']
    if (reserved.includes(username.toLowerCase())) return { error: 'Username is reserved.' }
    const conflict = await this.prisma.user.findFirst({ where: { username, NOT: { id: userId } } })
    if (conflict) return { error: 'Username already taken.' }
    await this.prisma.user.update({ where: { id: userId }, data: { username } })
    return { success: true, username }
  }
}
