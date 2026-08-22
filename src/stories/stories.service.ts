import { Injectable } from '@nestjs/common'
import { PrismaService } from '../common/prisma/prisma.service'

@Injectable()
export class StoriesService {
  constructor(private prisma: PrismaService) {}

  async getStories(userId: string) {
    const [follows, subs] = await Promise.all([
      this.prisma.follow.findMany({ where: { userId }, select: { creatorId: true } }),
      this.prisma.subscription.findMany({ where: { userId, status: 'ACTIVE' }, select: { creatorId: true } }),
    ])
    const creatorIds = [...new Set([...follows.map((f) => f.creatorId), ...subs.map((s) => s.creatorId)])]

    const stories = await this.prisma.story.findMany({
      where: { creatorId: { in: creatorIds }, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { id: true, displayName: true, handle: true, user: { select: { image: true } } } },
        views: { where: { userId }, select: { id: true } },
      },
    })

    return stories.map((s) => ({ ...s, viewed: s.views.length > 0 }))
  }

  async recordView(userId: string, storyId: string) {
    try {
      await this.prisma.$transaction([
        this.prisma.storyView.create({ data: { storyId, userId } }),
        this.prisma.story.update({ where: { id: storyId }, data: { viewCount: { increment: 1 } } }),
      ])
    } catch {}
    return { ok: true }
  }
}
