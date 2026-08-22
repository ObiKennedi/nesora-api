import { Injectable } from '@nestjs/common'
import { PrismaService } from '../common/prisma/prisma.service'

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async getNotifications(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit
    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip, take: limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
    ])
    return { notifications, total, pages: Math.ceil(total / limit), page }
  }

  async markRead(userId: string, notificationId: string) {
    const n = await this.prisma.notification.findFirst({ where: { id: notificationId, userId } })
    if (!n) return { error: 'Not found.' }
    await this.prisma.notification.update({ where: { id: notificationId }, data: { read: true } })
    return { success: true }
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } })
    return { success: true }
  }
}
