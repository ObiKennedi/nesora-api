import { Injectable } from '@nestjs/common'
import { PrismaService } from '../common/prisma/prisma.service'
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

const CACHE_TTL_SECONDS = 300 // 5 minutes cache

@Injectable()
export class DiscoverService {
  constructor(private prisma: PrismaService) {}

  async discover(
    userId: string,
    params?: { category?: string; search?: string; limit?: number },
  ) {
    const category =
      params?.category && params.category !== 'ALL' ? params.category : undefined
    const search = params?.search?.trim() || undefined
    const limit = params?.limit ?? 30

    const cacheKey = `cache:discover:${userId || 'anon'}:${category || 'ALL'}:${search || ''}`

    // 1. Check Redis Cache
    try {
      const cached = await redis.get<any[]>(cacheKey)
      if (cached && Array.isArray(cached) && cached.length > 0) {
        return cached
      }
    } catch (e) {
      // Non-blocking fallback
    }

    // 2. Track user category affinity in Redis if user queried a specific category
    if (userId && category) {
      try {
        await redis.zincrby(`user:affinity:${userId}`, 1, category)
        await redis.expire(`user:affinity:${userId}`, 86400 * 30) // 30 days
      } catch (e) {}
    }

    // 3. Find already followed or subscribed creator IDs to exclude
    let excludeIds: string[] = []
    if (userId) {
      const [follows, subs] = await Promise.all([
        this.prisma.follow.findMany({ where: { userId }, select: { creatorId: true } }),
        this.prisma.subscription.findMany({ where: { userId, status: 'ACTIVE' }, select: { creatorId: true } }),
      ])
      excludeIds = [...new Set([...follows.map((f) => f.creatorId), ...subs.map((s) => s.creatorId)])]
    }

    // 4. Fetch user top preferred categories from Redis or DB if category not explicitly selected
    let preferredCategories: string[] = []
    if (userId && !category) {
      try {
        const affinities = await redis.zrange<string[]>(`user:affinity:${userId}`, 0, 2, { rev: true })
        if (affinities && affinities.length > 0) {
          preferredCategories = affinities
        } else {
          const dbInterests = await this.prisma.userCategoryInterest.findMany({
            where: { userId },
            select: { category: true },
          })
          preferredCategories = dbInterests.map((i) => i.category)
        }
      } catch (e) {}
    }

    // 5. Query creators with category & search conditions
    const whereCondition: any = {
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
      ...(category
        ? { creatorCategories: { some: { category: category as any } } }
        : preferredCategories.length > 0
        ? { creatorCategories: { some: { category: { in: preferredCategories as any[] } } } }
        : {}),
      ...(search
        ? {
            OR: [
              { displayName: { contains: search, mode: 'insensitive' } },
              { handle: { contains: search, mode: 'insensitive' } },
              { bio: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    }

    let creators = await this.prisma.creator.findMany({
      where: whereCondition,
      select: {
        id: true,
        displayName: true,
        handle: true,
        isVerified: true,
        followersCount: true,
        subscribersCount: true,
        bio: true,
        subscriptionEnabled: true,
        bannerImage: true,
        creatorCategories: { select: { category: true } },
        user: { select: { image: true } },
        subscriptionPlans: {
          where: { isActive: true },
          orderBy: { price: 'asc' },
          take: 1,
          select: { id: true, name: true, price: true, interval: true },
        },
      },
      orderBy: { followersCount: 'desc' },
      take: limit,
    })

    // If preferred categories yielded fewer than 10 results and no specific category filter, backfill with trending creators
    if (!category && !search && creators.length < 15) {
      const existingCreatorIds = new Set(creators.map((c) => c.id))
      const allExclude = [...new Set([...excludeIds, ...Array.from(existingCreatorIds)])]

      const backfill = await this.prisma.creator.findMany({
        where: { id: { notIn: allExclude } },
        select: {
          id: true,
          displayName: true,
          handle: true,
          isVerified: true,
          followersCount: true,
          subscribersCount: true,
          bio: true,
          subscriptionEnabled: true,
          bannerImage: true,
          creatorCategories: { select: { category: true } },
          user: { select: { image: true } },
          subscriptionPlans: {
            where: { isActive: true },
            orderBy: { price: 'asc' },
            take: 1,
            select: { id: true, name: true, price: true, interval: true },
          },
        },
        orderBy: { followersCount: 'desc' },
        take: limit - creators.length,
      })

      creators = [...creators, ...backfill]
    }

    // 6. Cache recommendations in Redis
    try {
      await redis.set(cacheKey, creators, { ex: CACHE_TTL_SECONDS })
    } catch (e) {}

    return creators
  }
}
