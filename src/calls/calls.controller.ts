import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { CallsService } from './calls.service'
import { IsString, IsEnum, IsBoolean } from 'class-validator'
import { CallType } from '@prisma/client'

class InitiateCallDto {
  @IsString() conversationId: string
  @IsEnum(CallType) type: CallType
}

class RespondToCallDto {
  @IsBoolean() accept: boolean
}

@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallsController {
  constructor(private calls: CallsService) {}

  @Get('active-incoming')
  getActiveIncomingCall(@CurrentUser() user: any) {
    return this.calls.getActiveIncomingCall(user.id)
  }

  @Get('settings')
  getSettings(@CurrentUser() user: any) {

    return this.calls.getCallSettings(user.id)
  }

  @Post('settings')
  updateSettings(
    @CurrentUser() user: any,
    @Body()
    dto: {
      availableForCalls?: boolean
      voiceCallsEnabled?: boolean
      videoCallsEnabled?: boolean
      voiceCallRate?: number
      videoCallRate?: number
      topFanFreeCallCount?: number
    },
  ) {
    return this.calls.updateCallSettings(user.id, dto)
  }

  @Get('creator-status/:conversationId')
  getCreatorStatus(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
  ) {
    return this.calls.getCreatorCallStatus(user.id, conversationId)
  }

  @Post('initiate')
  initiate(@CurrentUser() user: any, @Body() dto: InitiateCallDto) {
    return this.calls.initiateCall(user.id, dto.conversationId, dto.type)
  }

  @Post(':id/respond')
  respond(
    @CurrentUser() user: any,
    @Param('id') callId: string,
    @Body() dto: RespondToCallDto,
  ) {
    return this.calls.respondToCall(user.id, callId, dto.accept)
  }

  @Post(':id/end')
  end(@CurrentUser() user: any, @Param('id') callId: string) {
    return this.calls.endCall(user.id, callId)
  }

  @Get('history')
  history(@CurrentUser() user: any) {
    return this.calls.getCallHistory(user.id)
  }
}

