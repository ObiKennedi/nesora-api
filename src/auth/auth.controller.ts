import { Controller, Post, Body, UseGuards, Get } from '@nestjs/common'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator'

class RegisterDto {
  @IsEmail() email: string
  @IsString() @MinLength(8) password: string
  @IsString() firstName: string
  @IsString() lastName: string
}

class LoginDto {
  @IsEmail() email: string
  @IsString() password: string
}

class GoogleLoginDto {
  @IsEmail() email: string
  @IsOptional() @IsString() name?: string
  @IsOptional() @IsString() image?: string
  @IsOptional() @IsString() googleId?: string
  @IsOptional() @IsString() idToken?: string
}

class RefreshDto {
  @IsString() refreshToken: string
}

class VerifyEmailDto {
  @IsString() token: string
}

class ForgotPasswordDto {
  @IsEmail() email: string
}

class ResetPasswordDto {
  @IsString() token: string
  @IsString() @MinLength(8) password: string
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto)
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password)
  }

  @Post('google')
  googleLogin(@Body() dto: GoogleLoginDto) {
    return this.auth.googleLogin(dto)
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refreshTokens(dto.refreshToken)
  }

  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token)
  }

  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email)
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password)
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: any) {
    return user
  }
}
