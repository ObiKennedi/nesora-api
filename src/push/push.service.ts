import { Injectable, Logger } from '@nestjs/common'
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk'
import { PrismaService } from '../common/prisma/prisma.service'

@Injectable()
export class PushService {
  private expo = new Expo()
  private readonly logger = new Logger(PushService.name)

  constructor(private prisma: PrismaService) {}

  // ── Register a device push token ─────────────────────────────────────────

  async registerToken(userId: string, expoPushToken: string) {
    if (!Expo.isExpoPushToken(expoPushToken)) {
      throw new Error(`Invalid Expo push token: ${expoPushToken}`)
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { expoPushToken },
    })
    return { success: true }
  }

  // ── Send a notification to a single user ──────────────────────────────────

  async sendToUser(
    userId: string,
    payload: {
      title: string
      body: string
      data?: Record<string, unknown>
      channelId?: string
      priority?: 'default' | 'normal' | 'high'
    },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { expoPushToken: true },
    })
    if (!user?.expoPushToken || !Expo.isExpoPushToken(user.expoPushToken)) return

    const message: ExpoPushMessage = {
      to: user.expoPushToken,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
      channelId: payload.channelId ?? 'default',
      priority: payload.priority ?? 'high',
      sound: 'default',
    }

    await this.sendMessages([message])
  }

  // ── Send VoIP/call push — displayed as full-screen incoming call ──────────
  // On Android: high-priority notification with full-screen intent
  // On iOS: high-priority notification (for true CallKit, the app uses
  //         react-native-callkeep + the data payload to trigger CallKit)

  async sendVoipToUser(
    userId: string,
    callPayload: {
      callId: string
      conversationId: string
      type: 'VOICE' | 'VIDEO'
      isFreeCall: boolean
      ratePerHour: number
      fan: { id: string; name: string; image: string | null }
    },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { expoPushToken: true },
    })
    if (!user?.expoPushToken || !Expo.isExpoPushToken(user.expoPushToken)) return

    const callLabel = callPayload.type === 'VOICE' ? 'Voice call' : 'Video call'

    const message: ExpoPushMessage = {
      to: user.expoPushToken,
      title: `📞 Incoming ${callLabel.toLowerCase()}`,
      body: `${callPayload.fan.name} is calling you`,
      data: {
        type: 'INCOMING_CALL',
        callId: callPayload.callId,
        conversationId: callPayload.conversationId,
        callType: callPayload.type,
        isFreeCall: callPayload.isFreeCall,
        ratePerHour: callPayload.ratePerHour,
        fan: callPayload.fan,
      },
      channelId: 'calls',
      priority: 'high',
      sound: 'default',
    }

    await this.sendMessages([message])
  }

  // ── Internal batch send ───────────────────────────────────────────────────

  private async sendMessages(messages: ExpoPushMessage[]) {
    const chunks = this.expo.chunkPushNotifications(messages)
    const tickets: ExpoPushTicket[] = []

    for (const chunk of chunks) {
      try {
        const chunkTickets = await this.expo.sendPushNotificationsAsync(chunk)
        tickets.push(...chunkTickets)
      } catch (error) {
        this.logger.error('Push chunk failed:', error)
      }
    }

    // Log any errors from tickets (non-blocking)
    for (const ticket of tickets) {
      if (ticket.status === 'error') {
        this.logger.warn(`Push ticket error: ${ticket.message}`)
      }
    }
  }
}
