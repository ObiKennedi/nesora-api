import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../common/prisma/prisma.service'
import { PushService } from '../push/push.service'
import { Prisma, CallType } from '@prisma/client'

// ── Daily.co helpers (mirrors lib/daily.ts) ───────────────────────────────────

const DAILY_API_BASE = 'https://api.daily.co/v1'
const ROOM_TTL_SECONDS = 4 * 60 * 60

async function dailyFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = process.env.DAILY_API_KEY
  if (!apiKey) throw new Error('DAILY_API_KEY is not set')
  const res = await fetch(`${DAILY_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Daily ${path} → ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

async function createCallRoom(roomName: string, callType: 'VOICE' | 'VIDEO') {
  const now = Math.floor(Date.now() / 1000)
  return dailyFetch<{ name: string; url: string }>('/rooms', {
    method: 'POST',
    body: JSON.stringify({
      name: roomName,
      privacy: 'private',
      properties: {
        exp: now + ROOM_TTL_SECONDS,
        eject_at_room_exp: true,
        max_participants: 2,
        enable_screenshare: false,
        enable_chat: false,
        start_video_off: callType === 'VOICE',
        start_audio_off: false,
      },
    }),
  })
}

async function createMeetingToken(params: {
  roomName: string
  userId: string
  userName: string
  isOwner?: boolean
}) {
  const now = Math.floor(Date.now() / 1000)
  const res = await dailyFetch<{ token: string }>('/meeting-tokens', {
    method: 'POST',
    body: JSON.stringify({
      properties: {
        room_name: params.roomName,
        user_id: params.userId,
        user_name: params.userName,
        is_owner: params.isOwner ?? false,
        exp: now + ROOM_TTL_SECONDS,
      },
    }),
  })
  return res.token
}

async function deleteRoom(roomName: string) {
  try {
    await dailyFetch(`/rooms/${encodeURIComponent(roomName)}`, { method: 'DELETE' })
  } catch {
    // Swallow 404s
  }
}

function generateRoomName() {
  return `call-${crypto.randomUUID()}`
}

// ── Billing helpers (mirrors lib/calls.ts) ────────────────────────────────────

const PLATFORM_FEE_RATE = new Prisma.Decimal('0.10')
const MIN_BALANCE_MINUTES = 5

function perMinuteRate(rph: Prisma.Decimal | number | string) {
  return new Prisma.Decimal(rph).div(60)
}

// ── Top fan check ─────────────────────────────────────────────────────────────

async function isTopFan(prisma: PrismaService, creatorId: string, userId: string, limit: number) {
  const topFans = await prisma.giftTransaction.groupBy({
    by: ['senderId'],
    where: { creatorId },
    _sum: { amount: true },
    orderBy: { _sum: { amount: 'desc' } },
    take: limit,
  })
  return topFans.some((f) => f.senderId === userId)
}

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class CallsService {
  constructor(
    private prisma: PrismaService,
    private push: PushService,
  ) {}

  // ── Initiate call ─────────────────────────────────────────────────────────

  async initiateCall(userId: string, conversationId: string, type: CallType) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, subscriberId: userId },
      include: {
        creator: {
          select: {
            id: true, userId: true, displayName: true,
            voiceCallsEnabled: true, videoCallsEnabled: true,
            voiceCallRate: true, videoCallRate: true,
            availableForCalls: true, topFanFreeCallCount: true,
          },
        },
      },
    })
    if (!conversation) throw new NotFoundException('Conversation not found.')
    if (conversation.creator.userId === userId) throw new ForbiddenException("You can't call yourself.")

    const creator = conversation.creator

    const enabled = type === 'VOICE' ? creator.voiceCallsEnabled : creator.videoCallsEnabled
    if (!enabled) throw new BadRequestException(`${creator.displayName} hasn't enabled ${type === 'VOICE' ? 'voice' : 'video'} calls.`)
    if (!creator.availableForCalls) throw new BadRequestException(`${creator.displayName} isn't available for calls right now.`)

    // Busy checks
    const [fanActive, creatorActive] = await Promise.all([
      this.prisma.call.findFirst({ where: { fanId: userId, status: { in: ['RINGING', 'IN_PROGRESS'] } }, select: { id: true } }),
      this.prisma.call.findFirst({ where: { creatorId: creator.id, status: { in: ['RINGING', 'IN_PROGRESS'] } }, select: { id: true } }),
    ])
    if (fanActive) throw new BadRequestException('You already have an active call.')
    if (creatorActive) throw new BadRequestException(`${creator.displayName} is on another call.`)

    // Rate + top fan
    const rawRate = type === 'VOICE' ? creator.voiceCallRate : creator.videoCallRate
    const ratePerHour = new Prisma.Decimal(rawRate ?? 0)
    const freeRate = ratePerHour.lte(0)
    const topFan = !freeRate ? await isTopFan(this.prisma, creator.id, userId, creator.topFanFreeCallCount) : false
    const isFreeCall = freeRate || topFan

    // Wallet check
    if (!isFreeCall) {
      const required = perMinuteRate(ratePerHour).mul(MIN_BALANCE_MINUTES).toDecimalPlaces(2)
      const wallet = await this.prisma.userWallet.findUnique({ where: { userId }, select: { balance: true } })
      const balance = wallet?.balance ?? new Prisma.Decimal(0)
      if (balance.lt(required)) {
        throw new BadRequestException({
          message: `You need at least ₦${Number(required).toLocaleString()} to start this call.`,
          code: 'INSUFFICIENT_BALANCE',
          required: Number(required),
          balance: Number(balance),
        })
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, image: true },
    })

    // Create Daily room
    const roomName = generateRoomName()
    const room = await createCallRoom(roomName, type)

    // Create Call row
    const call = await this.prisma.call.create({
      data: {
        conversationId,
        fanId: userId,
        creatorId: creator.id,
        type,
        dailyRoomName: room.name,
        dailyRoomUrl: room.url,
        ratePerHour: isFreeCall ? new Prisma.Decimal(0) : ratePerHour,
        isFreeCall,
        isTopFanCall: topFan,
      },
    })

    // Mint fan token
    const fanToken = await createMeetingToken({
      roomName: room.name,
      userId,
      userName: user?.name ?? 'Fan',
      isOwner: false,
    })

    // ── Ring the creator via Expo push (replaces Pusher incoming-call event) ──
    await this.push.sendVoipToUser(creator.userId, {
      callId: call.id,
      conversationId,
      type,
      isFreeCall,
      ratePerHour: Number(ratePerHour),
      fan: {
        id: userId,
        name: user?.name ?? 'A fan',
        image: user?.image ?? null,
      },
    })

    // Notification bell entry
    await this.prisma.notification.create({
      data: {
        userId: creator.userId,
        type: 'INCOMING_CALL',
        title: `Incoming ${type === 'VOICE' ? 'voice' : 'video'} call`,
        body: `${user?.name ?? 'A fan'} is calling you`,
        href: `/creator/messages/${conversationId}`,
      },
    })

    return {
      call: { id: call.id, type, isFreeCall, ratePerHour: Number(ratePerHour) },
      room: { url: room.url, token: fanToken },
    }
  }

  // ── Respond to call (creator accepts or declines) ─────────────────────────

  async respondToCall(userId: string, callId: string, accept: boolean) {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: { creator: { select: { userId: true, displayName: true } } },
    })
    if (!call) throw new NotFoundException('Call not found.')
    if (call.creator.userId !== userId) throw new ForbiddenException('Not authorized.')

    if (!accept) {
      const done = await this.prisma.call.updateMany({
        where: { id: callId, status: 'RINGING' },
        data: { status: 'DECLINED', endedAt: new Date() },
      })
      if (done.count === 0) throw new BadRequestException('This call is no longer ringing.')

      // Notify the fan that call was declined
      await this.push.sendToUser(call.fanId, {
        title: 'Call declined',
        body: `${call.creator.displayName} declined your call.`,
        data: { type: 'CALL_DECLINED', callId },
        channelId: 'calls',
      })

      return { accepted: false }
    }

    // Accept: claim RINGING → IN_PROGRESS atomically
    const claimed = await this.prisma.call.updateMany({
      where: { id: callId, status: 'RINGING' },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    })
    if (claimed.count === 0) throw new BadRequestException('This call is no longer ringing.')

    const creatorToken = await createMeetingToken({
      roomName: call.dailyRoomName,
      userId,
      userName: call.creator.displayName,
      isOwner: true,
    })

    // Tell the fan the call was accepted
    await this.push.sendToUser(call.fanId, {
      title: 'Call accepted',
      body: `${call.creator.displayName} accepted your call!`,
      data: { type: 'CALL_ACCEPTED', callId },
      channelId: 'calls',
      priority: 'high',
    })

    return {
      accepted: true,
      room: { url: call.dailyRoomUrl, token: creatorToken },
    }
  }

  // ── End call + billing ────────────────────────────────────────────────────

  async endCall(userId: string, callId: string) {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: {
        creator: { select: { userId: true, displayName: true } },
        fan: { select: { name: true, username: true } },
      },
    })
    if (!call) throw new NotFoundException('Call not found.')

    const isParticipant = call.fanId === userId || call.creator.userId === userId
    if (!isParticipant) throw new ForbiddenException('Not authorized.')

    if (!['IN_PROGRESS', 'RINGING'].includes(call.status)) {
      throw new BadRequestException('Call is not active.')
    }

    const endedAt = new Date()
    const startedAt = call.startedAt ?? endedAt
    const durationMs = endedAt.getTime() - startedAt.getTime()
    const durationMinutes = Math.ceil(durationMs / 60_000)

    await this.prisma.call.update({
      where: { id: callId },
      data: { status: 'ENDED', endedAt },
    })

    // Billing
    if (!call.isFreeCall && durationMinutes > 0) {
      const due = perMinuteRate(call.ratePerHour).mul(durationMinutes).toDecimalPlaces(2)
      const wallet = await this.prisma.userWallet.findUnique({
        where: { userId: call.fanId },
        select: { balance: true, id: true },
      })
      const balance = wallet?.balance ?? new Prisma.Decimal(0)
      const debited = balance.gte(due) ? due : balance

      if (debited.gt(0) && wallet) {
        const fee = debited.mul(PLATFORM_FEE_RATE).toDecimalPlaces(2)
        const net = debited.sub(fee)

        await this.prisma.$transaction([
          this.prisma.userWallet.update({ where: { userId: call.fanId }, data: { balance: { decrement: debited } } }),
          this.prisma.userWalletTransaction.create({
            data: { walletId: wallet.id, amount: debited, type: 'CALL_PAYMENT', description: `Call (${durationMinutes} min)` },
          }),
          this.prisma.creatorWallet.upsert({
            where: { creatorId: call.creatorId },
            create: { creatorId: call.creatorId, balance: net },
            update: { balance: { increment: net } },
          }),
          this.prisma.call.update({
            where: { id: callId },
            data: { billedMinutes: durationMinutes, billedAmount: { increment: debited }, platformFee: { increment: fee } },
          }),
        ])
      }
    }

    await deleteRoom(call.dailyRoomName)

    return { ended: true, durationMinutes }
  }

  // ── Call history ──────────────────────────────────────────────────────────

  async getCallHistory(userId: string) {
    const calls = await this.prisma.call.findMany({
      where: {
        OR: [
          { fanId: userId },
          { creator: { userId } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        creator: { select: { id: true, displayName: true, user: { select: { image: true } } } },
        fan: { select: { id: true, name: true, image: true } },
      },
    })
    return calls
  }

  // ── Call settings ──────────────────────────────────────────────────────────

  async getCallSettings(userId: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId },
      select: {
        id: true,
        availableForCalls: true,
        voiceCallsEnabled: true,
        videoCallsEnabled: true,
        voiceCallRate: true,
        videoCallRate: true,
        topFanFreeCallCount: true,
      },
    })
    if (!creator) {
      return {
        availableForCalls: true,
        voiceCallsEnabled: true,
        videoCallsEnabled: true,
        voiceCallRate: 0,
        videoCallRate: 0,
        topFanFreeCallCount: 5,
      }
    }

    return {
      availableForCalls: creator.availableForCalls ?? true,
      voiceCallsEnabled: creator.voiceCallsEnabled ?? true,
      videoCallsEnabled: creator.videoCallsEnabled ?? true,
      voiceCallRate: creator.voiceCallRate ? Number(creator.voiceCallRate) : 0,
      videoCallRate: creator.videoCallRate ? Number(creator.videoCallRate) : 0,
      topFanFreeCallCount: creator.topFanFreeCallCount ?? 5,
    }
  }

  async updateCallSettings(userId: string, data: {
    availableForCalls?: boolean
    voiceCallsEnabled?: boolean
    videoCallsEnabled?: boolean
    voiceCallRate?: number
    videoCallRate?: number
    topFanFreeCallCount?: number
  }) {
    let creator = await this.prisma.creator.findUnique({ where: { userId } })
    if (!creator) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } })
      creator = await this.prisma.creator.create({
        data: {
          userId,
          displayName: user?.name || 'Creator',
          handle: user?.username || `creator_${Date.now()}`,
        },
      })
    }

    await this.prisma.creator.update({
      where: { id: creator.id },
      data: {
        ...(data.availableForCalls !== undefined ? { availableForCalls: data.availableForCalls } : {}),
        ...(data.voiceCallsEnabled !== undefined ? { voiceCallsEnabled: data.voiceCallsEnabled } : {}),
        ...(data.videoCallsEnabled !== undefined ? { videoCallsEnabled: data.videoCallsEnabled } : {}),
        ...(data.voiceCallRate !== undefined ? { voiceCallRate: data.voiceCallRate } : {}),
        ...(data.videoCallRate !== undefined ? { videoCallRate: data.videoCallRate } : {}),
        ...(data.topFanFreeCallCount !== undefined ? { topFanFreeCallCount: data.topFanFreeCallCount } : {}),
      },
    })

    return { success: true }
  }

  async getCreatorCallStatus(userId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, OR: [{ subscriberId: userId }, { creator: { userId } }] },
      include: {
        creator: {
          select: {
            id: true,
            displayName: true,
            availableForCalls: true,
            voiceCallsEnabled: true,
            videoCallsEnabled: true,
            voiceCallRate: true,
            videoCallRate: true,
            topFanFreeCallCount: true,
            user: { select: { image: true } },
          },
        },
      },
    })
    if (!conversation) throw new NotFoundException('Conversation not found.')

    const creator = conversation.creator
    const isTopFanUser = await isTopFan(this.prisma, creator.id, userId, creator.topFanFreeCallCount ?? 5)

    return {
      creatorId: creator.id,
      creatorName: creator.displayName,
      creatorImage: creator.user?.image,
      availableForCalls: creator.availableForCalls ?? true,
      voiceCallsEnabled: creator.voiceCallsEnabled ?? true,
      videoCallsEnabled: creator.videoCallsEnabled ?? true,
      voiceCallRatePerHour: creator.voiceCallRate ? Number(creator.voiceCallRate) : 0,
      videoCallRatePerHour: creator.videoCallRate ? Number(creator.videoCallRate) : 0,
      isFreeCall: isTopFanUser || (!creator.voiceCallRate && !creator.videoCallRate),
      isTopFan: isTopFanUser,
    }
  }
}

