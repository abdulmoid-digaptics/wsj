import {ValidatedBody} from './validation';
import {Controller,Get,Post,Req,Res,UseGuards,UnauthorizedException,Inject,HttpException} from '@nestjs/common';
import {Throttle} from '@nestjs/throttler';
import {ApiTags,ApiBearerAuth} from '@nestjs/swagger';
import {compare} from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {Db,AuthGuard} from './core';
import {LoginDto} from './dto';
/** Per-account brute-force guard on top of the per-IP throttle: 10 failures in 15 minutes locks that email for 15 minutes. In-memory, so per API process. */
const LOGIN_WINDOW_MS=15*60000,LOGIN_MAX_FAILURES=10;const loginFailures=new Map<string,{count:number;since:number}>();
export function loginLocked(key:string,now=Date.now()){const f=loginFailures.get(key);if(f&&now-f.since>LOGIN_WINDOW_MS){loginFailures.delete(key);return false;}return Boolean(f&&f.count>=LOGIN_MAX_FAILURES);}
export function recordLoginFailure(key:string,now=Date.now()){const f=loginFailures.get(key);if(!f||now-f.since>LOGIN_WINDOW_MS)loginFailures.set(key,{count:1,since:now});else f.count++;if(loginFailures.size>10000)loginFailures.delete(loginFailures.keys().next().value!);}
export function clearLoginFailures(key:string){loginFailures.delete(key);}
@ApiTags('Authentication') @Controller('auth')
export class AuthController {
 constructor(@Inject(Db) private db:Db){}
 @Post('login') @Throttle({default:{limit:5,ttl:60000}})
 async login(@ValidatedBody(LoginDto) body:LoginDto,@Res({passthrough:true}) res:any){const lockKey=body.email.toLowerCase();if(loginLocked(lockKey))throw new HttpException('Too many failed sign-in attempts. Try again in 15 minutes.',429);const user=await this.db.user.findUnique({where:{email:lockKey}});const ok=await compare(body.password,user?.passwordHash||'$2b$12$C6UzMDM.H6dfI/f/IKcEe.2xqE5E5LGaBPa9kJ4QaMBjHHxNB5E2W');if(!user?.active||!ok){recordLoginFailure(lockKey);throw new UnauthorizedException('Invalid credentials');}clearLoginFailures(lockKey);const accessToken=jwt.sign({sub:user.id,v:user.tokenVersion},process.env.JWT_SECRET!,{expiresIn:'2h',algorithm:'HS256'});res.cookie('access_token',accessToken,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',maxAge:7200000,path:'/api'});await this.db.audit.create({data:{actorId:user.id,action:'LOGIN',resource:'auth'}});return {accessToken,user:{id:user.id,email:user.email,name:user.name,role:user.role}};}
 @Get('me') @UseGuards(AuthGuard) @ApiBearerAuth() me(@Req() req:any){return req.user;}
 @Post('logout') @UseGuards(AuthGuard) async logout(@Req() req:any,@Res({passthrough:true}) res:any){await this.db.user.update({where:{id:req.user.id},data:{tokenVersion:{increment:1}}});res.clearCookie('access_token',{path:'/api'});return {loggedOut:true};}
}
