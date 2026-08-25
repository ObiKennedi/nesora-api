import { Injectable } from '@nestjs/common'
import { PrismaService } from '../common/prisma/prisma.service'
import { PushService } from '../push/push.service'
import { Redis } from '@upstash/redis'
import { MessageType } from '@prisma/client'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

const keys = {
  unreadCount: (userId: string, convId: string) => `unread:${userId}:${convId}`,
  totalUnread: (userId: string) => `total_unread:${userId}`,
}

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private push: PushService,
  ) {}

  async getConversations(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: { subscriberId: userId },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, type: true, content: true, isRead: true, createdAt: true, senderId: true },
        },
        creator: {
          select: { id: true, displayName: true, handle: true, user: { select: { image: true } } },
        },
      },
    })

    const withUnread = await Promise.all(
      conversations.map(async (conv) => {
        const unread = (await redis.get<number>(keys.unreadCount(userId, conv.id))) ?? 0
        return { ...conv, unreadCount: unread }
      }),
    )
    return withUnread
  }

  async getMessages(userId: string, conversationId: string, page = 1, limit = 30) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, subscriberId: userId },
    })
    if (!conversation) return { error: 'Conversation not found.' }

    const skip = (page - 1) * limit
    const [messages, total] = await Promise.all([
      this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          sender: { select: { id: true, username: true, firstName: true, lastName: true, image: true } },
        },
      }),
      this.prisma.message.count({ where: { conversationId } }),
    ])

    await redis.set(keys.unreadCount(userId, conversationId), 0)
    await this.prisma.message.updateMany({
      where: { conversationId, isRead: false, senderId: { not: userId } },
      data: { isRead: true, readAt: new Date() },
    })

    return { messages: messages.reverse(), total, pages: Math.ceil(total / limit), page }
  }

  async sendMessage(
    userId: string,
    conversationId: string,
    data: {
      type: MessageType
      content?: string
      mediaUrl?: string
      voiceNoteUrl?: string
      voiceNotePublicId?: string
      voiceDuration?: number
    },
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, subscriberId: userId },
      include: { creator: { select: { userId: true } } },
    })
    if (!conversation) return { error: 'Conversation not found.' }

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId: userId,
        type: data.type,
        content: data.content,
        mediaUrl: data.mediaUrl,
        voiceNoteUrl: data.voiceNoteUrl,
        voiceNotePublicId: data.voiceNotePublicId,
        voiceDuration: data.voiceDuration,
      },
      include: {
        sender: { select: { id: true, username: true, firstName: true, lastName: true, image: true } },
      },
    })

    const preview =
      data.type === 'TEXT' ? (data.content?.slice(0, 100) ?? '')
      : data.type === 'VOICE_NOTE' ? '🎤 Voice note'
      : data.type === 'IMAGE' ? '📷 Photo'
      : data.type === 'VIDEO' ? '🎥 Video'
      : ''

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: message.createdAt, lastMessageText: preview },
    })

    const recipientId = conversation.creator.userId
    await redis.incr(keys.unreadCount(recipientId, conversationId))
    await redis.incr(keys.totalUnread(recipientId))

    // Push notification to creator (replaces Pusher new-conversation-message)
    const senderName = message.sender.firstName ?? 'Someone'
    await this.push.sendToUser(recipientId, {
      title: `New message from ${senderName}`,
      body: preview || 'Sent you a message',
      data: { type: 'NEW_MESSAGE', conversationId, messageId: message.id },
      channelId: 'messages',
    })

    return { success: true, message }
  }

  async sendMessageRequest(userId: string, creatorId: string, messageText: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { id: creatorId },
      select: { id: true, userId: true, displayName: true },
    })
    if (!creator) return { error: 'Creator not found.' }

    const existing = await this.prisma.conversation.findFirst({
      where: { creatorId, subscriberId: userId },
    })
    if (existing) return { error: 'You already have a conversation with this creator.' }

    const pending = await this.prisma.messageRequest.findFirst({
      where: { fromUserId: userId, toCreatorId: creatorId, status: 'PENDING' },
    })
    if (pending) return { error: 'You already have a pending request.' }

    const request = await this.prisma.messageRequest.create({
      data: { fromUserId: userId, toCreatorId: creatorId, message: messageText },
    })

    await this.push.sendToUser(creator.userId, {
      title: 'New message request',
      body: messageText.slice(0, 80),
      data: { type: 'NEW_MESSAGE_REQUEST', requestId: request.id },
      channelId: 'messages',
    })

    await this.prisma.notification.create({
      data: {
        userId: creator.userId,
        type: 'NEW_MESSAGE',
        title: 'New message request',
        body: messageText.slice(0, 80),
        href: '/creator/messages?tab=requests',
      },
    })

    return { success: true, requestId: request.id }
  }

  async startConversation(userId: string, creatorId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId, creatorId, status: 'ACTIVE' },
    })
    if (!subscription) return { error: 'You must be subscribed to message this creator.' }

    const existing = await this.prisma.conversation.findFirst({
      where: { creatorId, subscriberId: userId },
    })
    if (existing) return { success: true, conversationId: existing.id }

    const conversation = await this.prisma.conversation.create({
      data: { creatorId, subscriberId: userId },
    })
    return { success: true, conversationId: conversation.id }
  }

  async getFollowedCreators(userId: string) {
    const follows = await this.prisma.follow.findMany({
      where: { userId },
      include: {
        creator: {
          select: {
            id: true,
            displayName: true,
            handle: true,
            user: { select: { image: true } },
          },
        },
      },
    })

    const creatorIds = follows.map((f) => f.creator.id)

    const [subscriptions, conversations, pendingRequests] = await Promise.all([
      this.prisma.subscription.findMany({
        where: {
          userId,
          creatorId: { in: creatorIds },
          status: 'ACTIVE',
        },
        select: {
          creatorId: true,
          amountPaid: true,
          startedAt: true,
          expiresAt: true,
          subscriptionPlan: {
            select: {
              id: true,
              name: true,
              price: true,
              interval: true,
            },
          },
        },
      }),
      this.prisma.conversation.findMany({
        where: {
          subscriberId: userId,
          creatorId: { in: creatorIds },
        },
        select: { id: true, creatorId: true },
      }),
      this.prisma.messageRequest.findMany({
        where: {
          fromUserId: userId,
          toCreatorId: { in: creatorIds },
          status: 'PENDING',
        },
        select: { toCreatorId: true },
      }),
    ])

    const subscriptionMap = new Map(
      subscriptions.map((s) => [
        s.creatorId,
        {
          planName: s.subscriptionPlan?.name ?? null,
          planPrice: s.subscriptionPlan ? Number(s.subscriptionPlan.price) : null,
          interval: s.subscriptionPlan?.interval ?? null,
          startedAt: s.startedAt,
          expiresAt: s.expiresAt,
        },
      ]),
    )
    const conversationMap = new Map(conversations.map((c) => [c.creatorId, c.id]))
    const pendingSet = new Set(pendingRequests.map((r) => r.toCreatorId))

    return follows.map((f) => ({
      creator: f.creator,
      isSubscribed: subscriptionMap.has(f.creator.id),
      subscription: subscriptionMap.get(f.creator.id) ?? null,
      conversationId: conversationMap.get(f.creator.id) ?? null,
      hasPendingRequest: pendingSet.has(f.creator.id),
    }))
  }

  async getFanMessageRequests(userId: string) {
    return this.prisma.messageRequest.findMany({
      where: { fromUserId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        toCreator: {
          select: {
            id: true,
            displayName: true,
            handle: true,
            user: { select: { image: true } },
          },
        },
      },
    })
  }

  async getTotalUnread(userId: string) {
    const count = await redis.get<number>(keys.totalUnread(userId))
    return { count: count ?? 0 }
  }
}
