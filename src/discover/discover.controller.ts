import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { DiscoverService } from './discover.service'

@Controller('discover')
@UseGuards(JwtAuthGuard)
export class DiscoverController {
  constructor(private discoverService: DiscoverService) {}

  @Get()
  discover(
    @CurrentUser() u: any,
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    return this.discoverService.discover(u.id, { category, search })
  }
}

