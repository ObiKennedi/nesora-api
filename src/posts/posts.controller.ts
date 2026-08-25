import { Controller, Get, Post, Delete, Param, Body, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { PostsService } from './posts.service'

@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private posts: PostsService) {}
  @Get('creator/mine') getMine(@CurrentUser() u: any, @Query('page') p?: string) { return this.posts.getMyPosts(u.id, Number(p ?? 1)) }
  @Post() create(@CurrentUser() u: any, @Body() b: any) { return this.posts.createPost(u.id, b) }
  @Get(':id') getPost(@CurrentUser() u: any, @Param('id') id: string) { return this.posts.getPost(u.id, id) }
  @Post(':id/like') like(@CurrentUser() u: any, @Param('id') id: string) { return this.posts.likePost(u.id, id) }
  @Get(':id/comments') getComments(@Param('id') id: string, @Query('page') p?: string) { return this.posts.getComments(id, Number(p ?? 1)) }
  @Post(':id/comment') comment(@CurrentUser() u: any, @Param('id') id: string, @Body() b: { body: string; parentId?: string }) { return this.posts.addComment(u.id, id, b.body, b.parentId) }
  @Post(':id/save') save(@CurrentUser() u: any, @Param('id') id: string) { return this.posts.savePost(u.id, id) }
}

