import { Injectable } from '@nestjs/common'
import { PrismaService } from '../common/prisma/prisma.service'
import { PushService } from '../push/push.service'

@Injectable()
export class PostsService {
  constructor(private prisma: PrismaService, private push: PushService) {}

  async getPost(userId: string, postId: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, status: 'PUBLISHED' },
      include: {
        creator: { select: { userId: true, displayName: true, handle: true, user: { select: { image: true } } } },
        access: true,
        poll: { include: { options: true } },
      },
    })
    if (!post) return { status: 'not_found' }
    return { status: 'success', post }
  }

  async likePost(userId: string, postId: string) {
    const existing = await this.prisma.postLike.findUnique({ where: { postId_userId: { postId, userId } } })
    if (existing) {
      await this.prisma.$transaction([
        this.prisma.postLike.delete({ where: { postId_userId: { postId, userId } } }),
        this.prisma.post.update({ where: { id: postId }, data: { likeCount: { decrement: 1 } } }),
      ])
      return { liked: false }
    }
    await this.prisma.$transaction([
      this.prisma.postLike.create({ data: { postId, userId } }),
      this.prisma.post.update({ where: { id: postId }, data: { likeCount: { increment: 1 } } }),
    ])
    return { liked: true }
  }

  async getComments(postId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit
    const [comments, total] = await Promise.all([
      this.prisma.postComment.findMany({
        where: { postId, parentId: null },
        orderBy: { createdAt: 'desc' },
        skip, take: limit,
        include: {
          replies: { take: 3, orderBy: { createdAt: 'asc' } },
        },
      }),
      this.prisma.postComment.count({ where: { postId, parentId: null } }),
    ])
    return { comments, total, pages: Math.ceil(total / limit), page }
  }

  async addComment(userId: string, postId: string, body: string, parentId?: string) {
    const comment = await this.prisma.postComment.create({
      data: { postId, userId, body, parentId },
    })
    await this.prisma.post.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } })
    return { success: true, comment }
  }

  async savePost(userId: string, postId: string) {
    const existing = await this.prisma.postSave.findUnique({ where: { postId_userId: { postId, userId } } })
    if (existing) {
      await this.prisma.postSave.delete({ where: { postId_userId: { postId, userId } } })
      return { saved: false }
    }
    await this.prisma.postSave.create({ data: { userId, postId } })
    return { saved: true }
  }

  async createPost(userId: string, data: {
    type: any
    title?: string
    body?: string
    mediaUrls?: string[]
    thumbnailUrl?: string
    videoDuration?: number
    accessLevel?: any
    pollQuestion?: string
    pollOptions?: string[]
  }) {
    // Find creator for user
    const creator = await this.prisma.creator.findUnique({
      where: { userId },
      select: { id: true },
    })
    if (!creator) return { error: 'Creator profile not found. Please activate creator portal.' }

    const postType = data.type || 'PHOTO'
    const accessLevel = data.accessLevel || 'PUBLIC'

    const post = await this.prisma.post.create({
      data: {
        creatorId: creator.id,
        type: postType,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        title: data.title || null,
        body: data.body || null,
        mediaUrls: data.mediaUrls || [],
        thumbnailUrl: data.thumbnailUrl || (data.mediaUrls && data.mediaUrls[0]) || null,
        videoDuration: data.videoDuration || null,
        access: {
          create: {
            accessLevel,
            allowedPlanIds: [],
          },
        },
        ...(postType === 'POLL' && data.pollOptions && data.pollOptions.length > 0
          ? {
              poll: {
                create: {
                  question: data.pollQuestion || data.title || 'Community Poll',
                  options: {
                    create: data.pollOptions.map((opt) => ({ text: opt })),
                  },
                },
              },
            }
          : {}),
      },
      include: {
        access: true,
        poll: { include: { options: true } },
      },
    })

    return { success: true, post }
  }

  async getMyPosts(userId: string, page = 1, limit = 20) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId },
      select: { id: true },
    })
    if (!creator) return { posts: [], total: 0 }

    const skip = (page - 1) * limit
    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where: { creatorId: creator.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          access: true,
          poll: { include: { options: true } },
        },
      }),
      this.prisma.post.count({ where: { creatorId: creator.id } }),
    ])

    return { posts, total, pages: Math.ceil(total / limit), page }
  }
}

