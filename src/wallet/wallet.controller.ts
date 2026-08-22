import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { WalletService } from './wallet.service'

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private wallet: WalletService) {}
  @Get() getBalance(@CurrentUser() u: any) { return this.wallet.getBalance(u.id) }
  @Get('transactions') getTx(@CurrentUser() u: any, @Query('page') p?: string) { return this.wallet.getTransactions(u.id, Number(p ?? 1)) }
  @Post('credit') credit(@CurrentUser() u: any, @Body() b: { amountKobo: number; reference: string }) { return this.wallet.creditWallet(u.id, b.amountKobo, b.reference) }
}
