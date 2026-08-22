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
}
