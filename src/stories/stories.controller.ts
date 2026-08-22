import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { StoriesService } from './stories.service'

@Controller('stories')
@UseGuards(JwtAuthGuard)
export class StoriesController {
  constructor(private stories: StoriesService) {}
  @Get() get(@CurrentUser() u: any) { return this.stories.getStories(u.id) }
  @Post(':id/view') view(@CurrentUser() u: any, @Param('id') id: string) { return this.stories.recordView(u.id, id) }
}
