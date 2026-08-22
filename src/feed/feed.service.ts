import { Injectable } from '@nestjs/common'
import { PrismaService } from '../common/prisma/prisma.service'
import { Category, PostAccessLevel } from '@prisma/client'

const FEED_LIMIT = 20
const SHORTS_LIMIT = 15
const SHORTS_MAX_SECS = 120
const RANKED_RATIO = 0.7
const FRESH_RATIO = 0.3

function recencyScore(publishedAt: Date): number {
  const hoursOld = (Date.now() - publishedAt.getTime()) / 3_600_000
  return 1 / (1 + hoursOld * 0.02)
}

@Injectable()
export class FeedService {
  constructor(private prisma: PrismaService) {}

  private async getCreatorIds(userId: string) {
    const [follows, subs] = await Promise.all([
      this.prisma.follow.findMany({ where: { userId }, select: { creatorId: true } }),
      this.prisma.subscription.findMany({ where: { userId, status: 'ACTIVE' }, select: { creatorId: true } }),
    ])
    return [...new Set([...follows.map((f) => f.creatorId), ...subs.map((s) => s.creatorId)])]
  }

  private async resolveAccess(params: {
    userId: string
    creatorId: string
    accessLevel: PostAccessLevel
    allowedPlanIds: string[]
  }): Promise<{ hasAccess: boolean; lockReason: string | null }> {
    const { userId, creatorId, accessLevel, allowedPlanIds } = params
    switch (accessLevel) {
      case 'PUBLIC':
        return { hasAccess: true, lockReason: null }
      case 'FOLLOWERS_ONLY': {
        const f = await this.prisma.follow.findUnique({ where: { userId_creatorId: { userId, creatorId } } })
        return f ? { hasAccess: true, lockReason: null } : { hasAccess: false, lockReason: 'FOLLOWERS_ONLY' }
      }
      case 'SUBSCRIBERS_ONLY': {
        const s = await this.prisma.subscription.findFirst({ where: { userId, creatorId, status: 'ACTIVE' } })
        return s ? { hasAccess: true, lockReason: null } : { hasAccess: false, lockReason: 'SUBSCRIBERS_ONLY' }
      }
      case 'TOP_FANS_ONLY': {
        const top = await this.prisma.giftTransaction.groupBy({
          by: ['senderId'], where: { creatorId }, _sum: { amount: true },
          orderBy: { _sum: { amount: 'desc' } }, take: 50,
        })
        const isTop = top.some((f) => f.senderId === userId)
        return isTop ? { hasAccess: true, lockReason: null } : { hasAccess: false, lockReason: 'TOP_FANS_ONLY' }
      }
      default:
        return { hasAccess: false, lockReason: 'UNKNOWN' }
    }
  }

  async getFeed(userId: string, params?: { category?: Category | 'ALL'; page?: number; limit?: number }) {
    const page = params?.page ?? 1
    const limit = params?.limit ?? FEED_LIMIT
    const skip = (page - 1) * limit
    const category = params?.category ?? 'ALL'

    const creatorIds = await this.getCreatorIds(userId)
    if (creatorIds.length === 0) return { posts: [], total: 0, pages: 0, page, suggestedCreators: [] }

    const categoryFilter =
      category === 'ALL'
        ? {}
        : { creator: { creatorCategories: { some: { category } } } }

    const rawPosts = await this.prisma.post.findMany({
      where: { creatorId: { in: creatorIds }, status: 'PUBLISHED', ...categoryFilter },
      include: {
        creator: {
          select: {
            id: true, displayName: true, handle: true, isVerified: true,
            creatorCategories: { select: { category: true } },
            user: { select: { image: true } },
          },
        },
        access: true,
        poll: { include: { options: true } },
        likes: { where: { userId }, select: { id: true } },
        postSaves: { where: { userId }, select: { id: true } },
        postPurchases: { where: { userId }, select: { id: true } },
        _count: { select: { likes: true, comments: true } },
      },
      orderBy: { publishedAt: 'desc' },
      take: limit * 5,
    })

    // Score + sort
    const signals = await this.prisma.fanInterestSignal.findMany({
      where: { userId }, select: { creatorId: true, category: true, score: true },
    })
    const signalMap = new Map(signals.map((s) => [`${s.creatorId}:${s.category}`, s.score]))

    const scored = rawPosts.map((post) => {
      const cats = post.creator.creatorCategories.map((c) => c.category)
      const interest = cats.reduce((s, c) => s + (signalMap.get(`${post.creatorId}:${c}`) ?? 0), 0)
      const recency = recencyScore(post.publishedAt ?? post.createdAt)
      return { post, score: RANKED_RATIO * interest + FRESH_RATIO * recency, recency }
    })

    const ranked = [...scored].sort((a, b) => b.score - a.score)
    const fresh = [...scored].sort((a, b) => b.recency - a.recency)
    const seen = new Set<string>()
    const merged: typeof scored = []
    let ri = 0, fi = 0
    while (merged.length < limit * 3 && (ri < ranked.length || fi < fresh.length)) {
      for (let i = 0; i < 7 && ri < ranked.length; i++) {
        const item = ranked[ri++]
        if (!seen.has(item.post.id)) { seen.add(item.post.id); merged.push(item) }
      }
      for (let i = 0; i < 3 && fi < fresh.length; i++) {
        const item = fresh[fi++]
        if (!seen.has(item.post.id)) { seen.add(item.post.id); merged.push(item) }
      }
    }

    const paginated = merged.slice(skip, skip + limit)
    const postsWithAccess = await Promise.all(
      paginated.map(async ({ post }) => {
        const accessLevel = post.access?.accessLevel ?? 'PUBLIC'
        const allowedPlanIds = post.access?.allowedPlanIds ?? []
        const purchased = post.postPurchases.length > 0
        const { hasAccess, lockReason } = purchased
          ? { hasAccess: true, lockReason: null }
          : await this.resolveAccess({ userId, creatorId: post.creatorId, accessLevel, allowedPlanIds })

        return {
          id: post.id, type: post.type, status: post.status,
          title: post.title,
          body: hasAccess ? post.body : null,
          mediaUrls: hasAccess ? post.mediaUrls : [],
          thumbnailUrl: post.thumbnailUrl,
          videoDuration: post.videoDuration,
          publishedAt: post.publishedAt,
          likeCount: post._count.likes,
          commentCount: post._count.comments,
          isLiked: post.likes.length > 0,
          isSaved: post.postSaves.length > 0,
          isPurchased: purchased,
          hasAccess, lockReason,
          poll: hasAccess ? post.poll : null,
          creator: {
            id: post.creator.id, displayName: post.creator.displayName,
            handle: post.creator.handle, isVerified: post.creator.isVerified,
            image: post.creator.user.image,
            categories: post.creator.creatorCategories.map((c) => c.category),
          },
        }
      }),
    )

    return { posts: postsWithAccess, total: merged.length, pages: Math.ceil(merged.length / limit), page }
  }

  async getShorts(userId: string, params?: { page?: number; limit?: number }) {
    const page = params?.page ?? 1
    const limit = params?.limit ?? SHORTS_LIMIT
    const skip = (page - 1) * limit
    const creatorIds = await this.getCreatorIds(userId)
    if (creatorIds.length === 0) return { shorts: [], total: 0, pages: 0, page }

    const where = {
      creatorId: { in: creatorIds }, status: 'PUBLISHED' as const,
      type: 'VIDEO' as const, videoDuration: { lte: SHORTS_MAX_SECS, not: null },
    }

    const [shorts, total] = await Promise.all([
      this.prisma.post.findMany({
        where, orderBy: { publishedAt: 'desc' }, skip, take: limit,
        include: {
          creator: { select: { id: true, displayName: true, handle: true, isVerified: true, user: { select: { image: true } } } },
          access: true,
          likes: { where: { userId }, select: { id: true } },
          postSaves: { where: { userId }, select: { id: true } },
          postPurchases: { where: { userId }, select: { id: true } },
          _count: { select: { likes: true, comments: true } },
        },
      }),
      this.prisma.post.count({ where }),
    ])

    const result = await Promise.all(
      shorts.map(async (post) => {
        const accessLevel = post.access?.accessLevel ?? 'PUBLIC'
        const purchased = post.postPurchases.length > 0
        const { hasAccess, lockReason } = purchased
          ? { hasAccess: true, lockReason: null }
          : await this.resolveAccess({ userId, creatorId: post.creatorId, accessLevel, allowedPlanIds: post.access?.allowedPlanIds ?? [] })

        return {
          id: post.id, type: post.type, title: post.title,
          mediaUrls: hasAccess ? post.mediaUrls : [],
          thumbnailUrl: post.thumbnailUrl, videoDuration: post.videoDuration,
          publishedAt: post.publishedAt, likeCount: post._count.likes,
          commentCount: post._count.comments, isLiked: post.likes.length > 0,
          isSaved: post.postSaves.length > 0, isPurchased: purchased,
          hasAccess, lockReason,
          creator: {
            id: post.creator.id, displayName: post.creator.displayName,
            handle: post.creator.handle, isVerified: post.creator.isVerified,
            image: post.creator.user.image,
          },
        }
      }),
    )

    return { shorts: result, total, pages: Math.ceil(total / limit), page }
  }

  async recordView(userId: string, postId: string) {
    try {
      await this.prisma.$transaction([
        this.prisma.postView.create({ data: { postId, userId } }),
        this.prisma.post.update({ where: { id: postId }, data: { viewCount: { increment: 1 } } }),
      ])
    } catch { /* silently fail */ }
    return { ok: true }
  }
}
