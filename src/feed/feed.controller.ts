import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { FeedService } from './feed.service'

@Controller('feed')
@UseGuards(JwtAuthGuard)
export class FeedController {
  constructor(private feed: FeedService) {}

  @Get()
  getFeed(
    @CurrentUser() user: any,
    @Query('category') category?: string,
    @Query('page') page?: string,
  ) {
    return this.feed.getFeed(user.id, { category: category as any, page: Number(page ?? 1) })
  }

  @Get('shorts')
  getShorts(@CurrentUser() user: any, @Query('page') page?: string) {
    return this.feed.getShorts(user.id, { page: Number(page ?? 1) })
  }

  @Post('posts/:id/view')
  recordView(@CurrentUser() user: any, @Param('id') postId: string) {
    return this.feed.recordView(user.id, postId)
  }
}
