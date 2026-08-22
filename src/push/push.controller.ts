import { Controller, Post, Body, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { PushService } from './push.service'
import { IsString } from 'class-validator'

class RegisterTokenDto {
  @IsString() expoPushToken: string
}

@Controller('push')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private push: PushService) {}

  @Post('register-token')
  registerToken(
    @CurrentUser() user: any,
    @Body() dto: RegisterTokenDto,
  ) {
    return this.push.registerToken(user.id, dto.expoPushToken)
  }
}
