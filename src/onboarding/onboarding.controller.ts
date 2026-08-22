import { Controller, Post, Body, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { OnboardingService } from './onboarding.service'
import { IsEnum, IsString, MinLength, MaxLength, Matches } from 'class-validator'
import { OnboardingType } from '@prisma/client'

class SelectTypeDto { @IsEnum(OnboardingType) type: OnboardingType }
class SetUsernameDto {
  @IsString() @MinLength(3) @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'Username can only contain letters, numbers, and underscores.' })
  username: string
}

@Controller('onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private onboarding: OnboardingService) {}
  @Post('select-type') selectType(@CurrentUser() u: any, @Body() dto: SelectTypeDto) { return this.onboarding.selectType(u.id, dto.type) }
  @Post('username') setUsername(@CurrentUser() u: any, @Body() dto: SetUsernameDto) { return this.onboarding.setUsername(u.id, dto.username) }
}
