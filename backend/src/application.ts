import 'reflect-metadata';
import {Module,ValidationPipe} from '@nestjs/common';
import {NestFactory,APP_GUARD} from '@nestjs/core';
import {NestExpressApplication} from '@nestjs/platform-express';
import {ThrottlerModule,ThrottlerGuard} from '@nestjs/throttler';
import {SwaggerModule,DocumentBuilder} from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import {frontendOrigins} from './origins';
import {Db,AuthGuard} from './core';
import {Errors} from './errors';
import {AuthController} from './auth';
import {PublicController} from './public';
import {UsersController,OperationsController,ContentController} from './admin';
import {MediaController} from './media';
import {PaymentClient} from './payments';
import {BookingController,BookingAdminController,PublicBookingController,StripeWebhookController} from './booking';
@Module({imports:[ThrottlerModule.forRoot([{ttl:60000,limit:120}])],// PublicBookingController's literal 'public/booking-catalog' route must be
   // registered before PublicController's wildcard 'public/:resource', or the
   // wildcard would match first and this route would be unreachable.
   controllers:[AuthController,PublicBookingController,PublicController,UsersController,OperationsController,MediaController,BookingController,BookingAdminController,StripeWebhookController,ContentController],providers:[Db,AuthGuard,PaymentClient,{provide:APP_GUARD,useClass:ThrottlerGuard}]})
export class AppModule{}
export async function createApplication(moduleType:any=AppModule){if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32)throw new Error('JWT_SECRET must contain at least 32 characters');const origins=frontendOrigins();
// rawBody:true makes req.rawBody available on every request (Buffer, alongside
// the normal parsed JSON body) without disabling JSON parsing elsewhere. The
// Stripe webhook handler needs the exact raw bytes to verify its signature.
const app=await NestFactory.create<NestExpressApplication>(moduleType,{bodyParser:true,rawBody:true});app.use(helmet({crossOriginResourcePolicy:{policy:'cross-origin'}}));app.use(cookieParser());app.enableCors({origin:(origin,callback)=>callback(null,!origin||origins.includes(origin)),credentials:true});app.setGlobalPrefix('api');// enableImplicitConversion is intentionally OFF: with real decorator metadata
// (this build always emits it), an Array-typed field with no explicit @Type
// silently coerces a stray object/string into an empty array instead of being
// rejected, and an unguarded Boolean field coerces any non-empty string
// (including the literal "false") to true. Every field that legitimately needs
// string->number/date conversion already carries an explicit @Type/@IsDateString.
 app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true,transformOptions:{enableImplicitConversion:false}}));app.useGlobalFilters(new Errors());app.enableShutdownHooks();app.useStaticAssets(path.resolve(process.env.UPLOAD_DIR||'uploads'),{prefix:'/uploads/',setHeaders:(res:any)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");}});if(process.env.NODE_ENV!=='production'||process.env.SWAGGER_ENABLED==='true'){const doc=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Workspace Junction API').setVersion('1.0').addBearerAuth().build());SwaggerModule.setup('api/docs',app,doc);}return app;}

