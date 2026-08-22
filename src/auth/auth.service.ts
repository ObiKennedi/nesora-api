import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../common/prisma/prisma.service'
import { Resend } from 'resend'
import * as bcrypt from 'bcryptjs'
import * as crypto from 'crypto'

const resend = new Resend(process.env.RESEND_API_KEY!)
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nesora.org'

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  // ── Token factories ────────────────────────────────────────────────────────

  private signAccess(user: { id: string; role: string; onboardingType: string | null; username: string | null }) {
    return this.jwt.sign(
      {
        sub: user.id,
        role: user.role,
        onboardingType: user.onboardingType ?? null,
        username: user.username ?? null,
      },
      { expiresIn: '15m' },
    )
  }

  private signRefresh(userId: string) {
    return this.jwt.sign({ sub: userId, type: 'refresh' }, { expiresIn: '30d' })
  }

  private tokens(user: { id: string; role: string; onboardingType: any; username: string | null }) {
    return {
      accessToken: this.signAccess(user),
      refreshToken: this.signRefresh(user.id),
    }
  }

  // ── Register ──────────────────────────────────────────────────────────────

  async register(data: {
    email: string
    password: string
    firstName: string
    lastName: string
  }) {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } })
    if (existing) throw new ConflictException('An account with this email already exists.')

    // Build a safe unique username
    const base = `${data.firstName}${data.lastName}`.toLowerCase().replace(/[^a-z0-9]/g, '')
    let username = `${base}${Math.floor(1000 + Math.random() * 9000)}`
    const conflict = await this.prisma.user.findUnique({ where: { username } })
    if (conflict) username = `${base}${Date.now().toString().slice(-6)}`

    const hashed = await bcrypt.hash(data.password, 12)

    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        password: hashed,
        firstName: data.firstName,
        lastName: data.lastName,
        name: `${data.firstName} ${data.lastName}`,
        username,
      },
    })

    // Send verification email (reuses same token table as Next.js)
    const token = crypto.randomBytes(32).toString('hex')
    await this.prisma.verificationToken.create({
      data: {
        identifier: data.email,
        token,
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    })

    await resend.emails.send({
      from: 'Nesora <noreply@nesora.org>',
      to: data.email,
      subject: 'Verify your Nesora account',
      html: `<p>Hi ${data.firstName}, click below to verify your email:</p>
             <a href="${APP_URL}/verify-email?token=${token}">Verify Email</a>
             <p>This link expires in 24 hours.</p>`,
    })

    return { message: 'Registration successful. Check your email to verify your account.' }
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user || !user.password) throw new UnauthorizedException('Invalid credentials.')
    if (!user.emailVerified) throw new UnauthorizedException('Please verify your email first.')
    if (user.isSuspended) throw new UnauthorizedException('Your account has been suspended.')

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) throw new UnauthorizedException('Invalid credentials.')

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        username: user.username,
        image: user.image,
        role: user.role,
        onboardingType: user.onboardingType,
      },
      ...this.tokens(user),
    }
  }

  // ── Refresh ───────────────────────────────────────────────────────────────

  async refreshTokens(refreshToken: string) {
    let payload: any
    try {
      payload = this.jwt.verify(refreshToken)
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token.')
    }

    if (payload.type !== 'refresh') throw new UnauthorizedException('Invalid token type.')

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, onboardingType: true, username: true, isSuspended: true },
    })
    if (!user || user.isSuspended) throw new UnauthorizedException()

    return this.tokens(user)
  }

  // ── Verify email ──────────────────────────────────────────────────────────

  async verifyEmail(token: string) {
    const record = await this.prisma.verificationToken.findFirst({
      where: { token, expires: { gt: new Date() } },
    })
    if (!record) throw new BadRequestException('Invalid or expired verification link.')

    await this.prisma.user.update({
      where: { email: record.identifier },
      data: { emailVerified: new Date() },
    })

    await this.prisma.verificationToken.deleteMany({ where: { identifier: record.identifier } })

    return { message: 'Email verified successfully.' }
  }

  // ── Forgot password ───────────────────────────────────────────────────────

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } })
    // Always respond success to avoid user enumeration
    if (!user) return { message: 'If this email is registered, you will receive a reset link.' }

    const token = crypto.randomBytes(32).toString('hex')
    await this.prisma.passwordResetToken.upsert({
      where: { email },
      create: { email, token, expires: new Date(Date.now() + 60 * 60 * 1000) },
      update: { token, expires: new Date(Date.now() + 60 * 60 * 1000) },
    })

    await resend.emails.send({
      from: 'Nesora <noreply@nesora.org>',
      to: email,
      subject: 'Reset your Nesora password',
      html: `<p>Click below to reset your password (expires in 1 hour):</p>
             <a href="${APP_URL}/reset-password?token=${token}">Reset Password</a>`,
    })

    return { message: 'If this email is registered, you will receive a reset link.' }
  }

  // ── Reset password ────────────────────────────────────────────────────────

  async resetPassword(token: string, password: string) {
    const record = await this.prisma.passwordResetToken.findFirst({
      where: { token, expires: { gt: new Date() } },
    })
    if (!record) throw new BadRequestException('Invalid or expired reset link.')

    const hashed = await bcrypt.hash(password, 12)
    await this.prisma.user.update({
      where: { email: record.email },
      data: { password: hashed },
    })
    await this.prisma.passwordResetToken.delete({ where: { email: record.email } })

    return { message: 'Password reset successfully. You can now log in.' }
  }
}
