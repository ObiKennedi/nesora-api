import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { WalletService } from './wallet.service'

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private wallet: WalletService) {}

  // ── Fan Wallet ──
  @Get() getBalance(@CurrentUser() u: any) { return this.wallet.getBalance(u.id) }
  @Get('transactions') getTx(@CurrentUser() u: any, @Query('page') p?: string) { return this.wallet.getTransactions(u.id, Number(p ?? 1)) }
  @Post('initialize') initialize(@CurrentUser() u: any, @Body() b: { amount: number }) { return this.wallet.initializeTopUp(u.id, b.amount) }
  @Post('verify') verify(@CurrentUser() u: any, @Body() b: { reference: string }) { return this.wallet.verifyTopUp(u.id, b.reference) }
  @Post('credit') credit(@CurrentUser() u: any, @Body() b: { amountKobo: number; reference: string }) { return this.wallet.creditWallet(u.id, b.amountKobo, b.reference) }

  // ── Creator Wallet & Payouts ──
  @Get('creator/balance') getCreatorBalance(@CurrentUser() u: any) { return this.wallet.getCreatorWalletBalance(u.id) }
  @Get('creator/banks') getCreatorBanks(@CurrentUser() u: any) { return this.wallet.getCreatorBankAccounts(u.id) }
  @Post('creator/banks') addCreatorBank(@CurrentUser() u: any, @Body() b: { bankName: string; accountName: string; accountNumber: string; bankCode?: string }) { return this.wallet.addCreatorBankAccount(u.id, b) }
  @Post('creator/banks/:id/default') setDefaultBank(@CurrentUser() u: any, @Param('id') id: string) { return this.wallet.setDefaultCreatorBankAccount(u.id, id) }
  @Delete('creator/banks/:id') deleteBank(@CurrentUser() u: any, @Param('id') id: string) { return this.wallet.deleteCreatorBankAccount(u.id, id) }
  @Post('creator/payout') requestPayout(@CurrentUser() u: any, @Body() b: { amount: number; bankAccountId?: string }) { return this.wallet.requestCreatorPayout(u.id, b.amount, b.bankAccountId) }
  @Get('creator/payouts') getCreatorPayouts(@CurrentUser() u: any) { return this.wallet.getCreatorPayouts(u.id) }
}


