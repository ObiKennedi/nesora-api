import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  // Global API prefix
  app.setGlobalPrefix('api/v1')

  // CORS — allow mobile app origin + web app
  app.enableCors({
    origin: ['http://localhost:3000', 'https://nesora.org', /^exp:\/\//],
    credentials: true,
  })

  // Global validation pipe — strips unknown fields, transforms types
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  )

  const port = process.env.PORT ?? 4000
  await app.listen(port)
  console.log(`Nesora API running on http://localhost:${port}/api/v1`)
}

bootstrap()
