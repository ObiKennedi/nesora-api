import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ThrottlerModule } from '@nestjs/throttler'
import { PrismaModule } from './common/prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { PushModule } from './push/push.module'
import { FeedModule } from './feed/feed.module'
import { CreatorsModule } from './creators/creators.module'
import { PostsModule } from './posts/posts.module'
import { StoriesModule } from './stories/stories.module'
import { MessagesModule } from './messages/messages.module'
import { CallsModule } from './calls/calls.module'
import { NotificationsModule } from './notifications/notifications.module'
import { SubscriptionModule } from './subscription/subscription.module'
import { WalletModule } from './wallet/wallet.module'
import { LiveModule } from './live/live.module'
import { DiscoverModule } from './discover/discover.module'
import { OnboardingModule } from './onboarding/onboarding.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuthModule,
    PushModule,
    FeedModule,
    CreatorsModule,
    PostsModule,
    StoriesModule,
    MessagesModule,
    CallsModule,
    NotificationsModule,
    SubscriptionModule,
    WalletModule,
    LiveModule,
    DiscoverModule,
    OnboardingModule,
  ],
})
export class AppModule {}
