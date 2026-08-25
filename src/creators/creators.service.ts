import { Injectable } from '@nestjs/common'
import { PrismaService } from '../common/prisma/prisma.service'

const TOP_FAN_LIMIT = 50
const GRID_PAGE_SIZE = 12

@Injectable()
export class CreatorsService {
  constructor(private prisma: PrismaService) {}

  private async resolveIdentifier(identifier: string) {
    const byUsername = await this.prisma.user.findUnique({
      where: { username: identifier },
      select: { id: true, username: true, creator: { select: { id: true } } },
    })
    if (byUsername?.creator) return { creatorId: byUsername.creator.id, ownerUserId: byUsername.id, username: byUsername.username }
    const byId = await this.prisma.creator.findUnique({
      where: { id: identifier },
      select: { id: true, userId: true, user: { select: { username: true } } },
    })
    if (byId) return { creatorId: byId.id, ownerUserId: byId.userId, username: byId.user.username }
    return null
  }

  async getProfile(userId: string, identifier: string) {
    const resolved = await this.resolveIdentifier(identifier)
    if (!resolved) return { status: 'not_found' }

    const creator = await this.prisma.creator.findUnique({
      where: { id: resolved.creatorId },
      select: {
        id: true, displayName: true, bio: true, isVerified: true, bannerImage: true,
        websiteUrl: true, accentColor: true, followersCount: true, subscribersCount: true,
        subscriptionEnabled: true, instagramUrl: true, twitterUrl: true, tiktokUrl: true, youtubeUrl: true,
        user: { select: { image: true } },
        creatorCategories: { select: { category: true } },
        subscriptionPlans: {
          where: { isActive: true }, orderBy: { price: 'asc' },
          select: { id: true, name: true, price: true, interval: true, benefits: true },
        },
        _count: { select: { posts: { where: { status: 'PUBLISHED' } } } },
        voiceCallsEnabled: true, videoCallsEnabled: true, voiceCallRate: true, videoCallRate: true, availableForCalls: true,
      },
    })
    if (!creator) return { status: 'not_found' }

    const [follow, subscription] = await Promise.all([
      userId ? this.prisma.follow.findUnique({ where: { userId_creatorId: { userId, creatorId: resolved.creatorId } }, select: { id: true } }) : null,
      userId ? this.prisma.subscription.findFirst({ where: { userId, creatorId: resolved.creatorId, status: 'ACTIVE', expiresAt: { gt: new Date() } }, select: { id: true } }) : null,
    ])

    return {
      status: 'success',
      creator: {
        id: creator.id, displayName: creator.displayName, username: resolved.username,
        bio: creator.bio, isVerified: creator.isVerified, image: creator.user.image,
        bannerImage: creator.bannerImage, websiteUrl: creator.websiteUrl, accentColor: creator.accentColor,
        followersCount: creator.followersCount, subscribersCount: creator.subscribersCount,
        postsCount: creator._count.posts, subscriptionEnabled: creator.subscriptionEnabled,
        voiceCallsEnabled: creator.voiceCallsEnabled, videoCallsEnabled: creator.videoCallsEnabled,
        voiceCallRate: creator.voiceCallRate ? Number(creator.voiceCallRate) : null,
        videoCallRate: creator.videoCallRate ? Number(creator.videoCallRate) : null,
        availableForCalls: creator.availableForCalls,
        categories: creator.creatorCategories.map((c) => c.category),
        plans: creator.subscriptionPlans.map((p) => ({ ...p, price: Number(p.price) })),
        socials: { instagram: creator.instagramUrl, twitter: creator.twitterUrl, tiktok: creator.tiktokUrl, youtube: creator.youtubeUrl },
      },
      viewer: {
        isAuthenticated: !!userId,
        isOwnProfile: userId === resolved.ownerUserId,
        isFollowing: !!follow,
        isSubscribed: !!subscription,
      },
    }
  }

  async getPosts(userId: string, identifier: string, tab: 'posts' | 'shorts' = 'posts', cursor?: string) {
    const resolved = await this.resolveIdentifier(identifier)
    if (!resolved) return { status: 'not_found' }
    const { creatorId, ownerUserId } = resolved
    const isOwnProfile = userId === ownerUserId

    const posts = await this.prisma.post.findMany({
      where: { creatorId, status: 'PUBLISHED', ...(tab === 'shorts' ? { type: 'VIDEO' } : {}) },
      orderBy: { publishedAt: 'desc' },
      take: GRID_PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, type: true, body: true, title: true, thumbnailUrl: true, mediaUrls: true,
        videoDuration: true, likeCount: true, commentCount: true, publishedAt: true,
        access: { select: { accessLevel: true, allowedPlanIds: true } },
      },
    })

    const hasMore = posts.length > GRID_PAGE_SIZE
    const pagePosts = hasMore ? posts.slice(0, GRID_PAGE_SIZE) : posts

    const [{ isFollowing, subscription }, purchases] = await Promise.all([
      (async () => {
        if (!userId) return { isFollowing: false, subscription: null as any }
        const [f, s] = await Promise.all([
          this.prisma.follow.findUnique({ where: { userId_creatorId: { userId, creatorId } }, select: { id: true } }),
          this.prisma.subscription.findFirst({ where: { userId, creatorId, status: 'ACTIVE', expiresAt: { gt: new Date() } }, select: { planId: true, subscriptionPlanId: true } }),
        ])
        return { isFollowing: !!f, subscription: s }
      })(),
      userId
        ? this.prisma.postPurchase.findMany({ where: { userId, postId: { in: pagePosts.map((p) => p.id) } }, select: { postId: true } })
        : Promise.resolve([]),
    ])
    const purchasedIds = new Set(purchases.map((p) => p.postId))
    const viewerPlanId = subscription?.planId ?? subscription?.subscriptionPlanId ?? null

    const resolveUnlocked = (accessLevel: string, allowedPlanIds: string[], postId: string) => {
      if (isOwnProfile) return true
      if (purchasedIds.has(postId)) return true
      switch (accessLevel) {
        case 'PUBLIC': return true
        case 'FOLLOWERS_ONLY': return isFollowing || !!subscription
        case 'SUBSCRIBERS_ONLY': return !!subscription
        case 'PLAN_SPECIFIC': return !!viewerPlanId && allowedPlanIds.includes(viewerPlanId)
        default: return false
      }
    }

    return {
      status: 'success',
      nextCursor: hasMore ? pagePosts[pagePosts.length - 1].id : null,
      posts: pagePosts.map((post) => {
        const accessLevel = post.access?.accessLevel ?? 'PUBLIC'
        const allowedPlanIds = post.access?.allowedPlanIds ?? []
        const unlocked = resolveUnlocked(accessLevel, allowedPlanIds, post.id)
        return {
          id: post.id, type: post.type, thumbnailUrl: post.thumbnailUrl,
          previewUrl: unlocked ? (post.mediaUrls[0] ?? null) : null,
          snippet: unlocked ? ((post.title || post.body)?.slice(0, 140) ?? null) : null,
          mediaCount: post.mediaUrls.length, videoDuration: post.videoDuration,
          likeCount: post.likeCount, commentCount: post.commentCount,
          accessLevel, unlocked, publishedAt: post.publishedAt,
        }
      }),
    }
  }

  async toggleFollow(userId: string, creatorId: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { id: creatorId },
      select: { id: true, userId: true, followersCount: true, user: { select: { username: true } } },
    })
    if (!creator) return { error: 'Creator not found.' }
    if (creator.userId === userId) return { error: "You can't follow yourself." }

    const existing = await this.prisma.follow.findUnique({ where: { userId_creatorId: { userId, creatorId } } })
    if (existing) {
      const [, updated] = await this.prisma.$transaction([
        this.prisma.follow.delete({ where: { id: existing.id } }),
        this.prisma.creator.update({ where: { id: creatorId }, data: { followersCount: { decrement: 1 } } }),
      ])
      return { following: false, followersCount: updated.followersCount }
    }

    const [, updated] = await this.prisma.$transaction([
      this.prisma.follow.create({ data: { userId, creatorId } }),
      this.prisma.creator.update({ where: { id: creatorId }, data: { followersCount: { increment: 1 } } }),
    ])
    return { following: true, followersCount: updated.followersCount }
  }

  async discover(userId: string) {
    const [follows, subs] = await Promise.all([
      this.prisma.follow.findMany({ where: { userId }, select: { creatorId: true } }),
      this.prisma.subscription.findMany({ where: { userId, status: 'ACTIVE' }, select: { creatorId: true } }),
    ])
    const alreadyIds = [...new Set([...follows.map((f) => f.creatorId), ...subs.map((s) => s.creatorId)])]

    return this.prisma.creator.findMany({
      where: { id: { notIn: alreadyIds } },
      select: {
        id: true, displayName: true, handle: true, isVerified: true,
        followersCount: true, bio: true, subscriptionEnabled: true,
        creatorCategories: { select: { category: true } },
        user: { select: { image: true } },
        subscriptionPlans: { where: { isActive: true }, orderBy: { price: 'asc' }, take: 1, select: { price: true, interval: true } },
      },
      orderBy: { followersCount: 'desc' },
      take: 30,
    })
  }

  async getAudience(userId: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId },
      select: { id: true, followersCount: true, subscribersCount: true },
    })
    if (!creator) {
      return {
        followers: [],
        subscribers: [],
        topFans: [],
        stats: { followersCount: 0, subscribersCount: 0, topFansCount: 0 },
      }
    }

    const [follows, subscribers, gifts, tips] = await Promise.all([
      // 1. Followers
      this.prisma.follow.findMany({
        where: { creatorId: creator.id },
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, username: true, firstName: true, lastName: true, image: true },
          },
        },
      }),
      // 2. Active Paid Subscribers
      this.prisma.subscription.findMany({
        where: { creatorId: creator.id, status: 'ACTIVE' },
        orderBy: { startedAt: 'desc' },
        include: {
          user: {
            select: { id: true, username: true, firstName: true, lastName: true, image: true },
          },
          subscriptionPlan: {
            select: { id: true, name: true, price: true, interval: true },
          },
        },
      }),
      // 3. Top spenders from gifts
      this.prisma.giftTransaction.groupBy({
        by: ['senderId'],
        where: { creatorId: creator.id },
        _sum: { amount: true },
        _count: { id: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 50,
      }),
      // 4. Top spenders from tips
      this.prisma.tip.groupBy({
        by: ['fromUserId'],
        where: { creatorId: creator.id },
        _sum: { amount: true },
        _count: { id: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 50,
      }),
    ])

    // Merge gift + tip spend
    const supporterMap = new Map<string, { totalSpend: number; giftCount: number }>()
    for (const g of gifts) {
      const existing = supporterMap.get(g.senderId) ?? { totalSpend: 0, giftCount: 0 }
      existing.totalSpend += Number(g._sum.amount ?? 0)
      existing.giftCount += g._count.id
      supporterMap.set(g.senderId, existing)
    }
    for (const t of tips) {
      const existing = supporterMap.get(t.fromUserId) ?? { totalSpend: 0, giftCount: 0 }
      existing.totalSpend += Number(t._sum.amount ?? 0)
      existing.giftCount += t._count.id
      supporterMap.set(t.fromUserId, existing)
    }

    const topUserIds = Array.from(supporterMap.keys())
    const topUsers =
      topUserIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: topUserIds } },
            select: { id: true, username: true, firstName: true, lastName: true, image: true },
          })
        : []

    const userMap = new Map(topUsers.map((u) => [u.id, u]))

    const sortedTopFans = Array.from(supporterMap.entries())
      .map(([uid, stats]) => ({
        user: userMap.get(uid),
        totalSpend: stats.totalSpend,
        giftCount: stats.giftCount,
      }))
      .filter((tf) => tf.user)
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .map((tf, index) => ({
        ...tf,
        rank: index + 1,
      }))

    return {
      followers: follows.map((f) => ({
        id: f.id,
        createdAt: f.createdAt,
        user: f.user,
      })),
      subscribers: subscribers.map((s) => ({
        id: s.id,
        startedAt: s.startedAt,
        expiresAt: s.expiresAt,
        amountPaid: Number(s.amountPaid),
        plan: s.subscriptionPlan
          ? { ...s.subscriptionPlan, price: Number(s.subscriptionPlan.price) }
          : null,
        user: s.user,
      })),
      topFans: sortedTopFans,
      stats: {
        followersCount: creator.followersCount,
        subscribersCount: creator.subscribersCount,
        topFansCount: sortedTopFans.length,
      },
    }
  }
}

