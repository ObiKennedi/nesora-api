import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { CreatorsService } from './creators.service'

@Controller('creators')
@UseGuards(JwtAuthGuard)
export class CreatorsController {
  constructor(private creators: CreatorsService) {}
  @Get('discover') discover(@CurrentUser() u: any) { return this.creators.discover(u.id) }
  @Get(':identifier') getProfile(@CurrentUser() u: any, @Param('identifier') id: string) { return this.creators.getProfile(u.id, id) }
  @Get(':identifier/posts') getPosts(@CurrentUser() u: any, @Param('identifier') id: string, @Query('tab') tab: any, @Query('cursor') cursor?: string) { return this.creators.getPosts(u.id, id, tab, cursor) }
  @Post(':id/follow') follow(@CurrentUser() u: any, @Param('id') id: string) { return this.creators.toggleFollow(u.id, id) }
}
