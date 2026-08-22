import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { MessagesService } from './messages.service'
import { IsString, IsEnum, IsOptional, IsNumber } from 'class-validator'
import { MessageType } from '@prisma/client'
import { Type } from 'class-transformer'

class SendMessageDto {
  @IsEnum(MessageType) type: MessageType
  @IsOptional() @IsString() content?: string
  @IsOptional() @IsString() mediaUrl?: string
  @IsOptional() @IsString() voiceNoteUrl?: string
  @IsOptional() @IsString() voiceNotePublicId?: string
  @IsOptional() @IsNumber() @Type(() => Number) voiceDuration?: number
}

class MessageRequestDto {
  @IsString() creatorId: string
  @IsString() message: string
}

class StartConversationDto {
  @IsString() creatorId: string
}

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private messages: MessagesService) {}

  @Get()
  getConversations(@CurrentUser() user: any) {
    return this.messages.getConversations(user.id)
  }

  @Get('unread')
  getTotalUnread(@CurrentUser() user: any) {
    return this.messages.getTotalUnread(user.id)
  }

  @Get(':conversationId')
  getMessages(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messages.getMessages(user.id, conversationId, Number(page ?? 1), Number(limit ?? 30))
  }

  @Post(':conversationId/send')
  sendMessage(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messages.sendMessage(user.id, conversationId, dto)
  }

  @Post('request')
  sendRequest(@CurrentUser() user: any, @Body() dto: MessageRequestDto) {
    return this.messages.sendMessageRequest(user.id, dto.creatorId, dto.message)
  }

  @Post('start')
  startConversation(@CurrentUser() user: any, @Body() dto: StartConversationDto) {
    return this.messages.startConversation(user.id, dto.creatorId)
  }
}
