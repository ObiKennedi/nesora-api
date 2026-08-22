import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { LiveService } from './live.service'

@Controller('live')
@UseGuards(JwtAuthGuard)
export class LiveController {
  constructor(private live: LiveService) {}
  @Get() getAll() { return this.live.getLiveStreams() }
  @Get(':id') getOne(@Param('id') id: string) { return this.live.getStream(id) }
}
