import { Module } from '@nestjs/common'
import { DiscoverController } from './discover.controller'
import { CreatorsService } from '../creators/creators.service'

@Module({ controllers: [DiscoverController], providers: [CreatorsService] })
export class DiscoverModule {}
