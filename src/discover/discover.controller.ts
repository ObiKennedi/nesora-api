import { Controller, Get, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { CreatorsService } from '../creators/creators.service'

@Controller('discover')
@UseGuards(JwtAuthGuard)
export class DiscoverController {
  constructor(private creators: CreatorsService) {}
  @Get() discover(@CurrentUser() u: any) { return this.creators.discover(u.id) }
}
