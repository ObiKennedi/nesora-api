import { Injectable } from '@nestjs/common'
import { PrismaService } from '../common/prisma/prisma.service'

@Injectable()
export class LiveService {
  constructor(private prisma: PrismaService) {}

  async getLiveStreams() {
    return this.prisma.liveStream.findMany({
      where: { status: 'LIVE' },
      include: { creator: { select: { id: true, displayName: true, handle: true, user: { select: { image: true } } } } },
      orderBy: { startedAt: 'desc' },
      take: 20,
    })
  }

  async getStream(streamId: string) {
    return this.prisma.liveStream.findUnique({
      where: { id: streamId },
      include: { creator: { select: { id: true, displayName: true, handle: true, user: { select: { image: true } } } } },
    })
  }
}
