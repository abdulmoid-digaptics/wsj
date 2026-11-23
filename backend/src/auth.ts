import {ValidatedBody} from './validation';
import {Controller,Get,Post,Req,Res,UseGuards,UnauthorizedException,Inject,HttpException} from '@nestjs/common';
import {Throttle} from '@nestjs/throttler';
import {ApiTags,ApiBearerAuth} from '@nestjs/swagger';
import {compare} from 'bcryptjs';
import {createHmac} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {Db,AuthGuard} from './core';
import {LoginDto} from './dto';
/**
 * Per-account brute-force guard on top of the per-IP throttle: 10 failures in 15 minutes locks that
 * email for the rest of the window; a successful sign-in resets the count. Failures are Audit rows
 * (action LOGIN_FAILED), so the lock is shared by every API worker and survives restarts. Unknown
 * emails lock exactly like real ones, so the 429 is not an account-existence signal. The key is an
 * HMAC of the normalised email: the audit trail never stores the raw address of a failed attempt.
 */
export const LOGIN_WINDOW_MS=15*60000,LOGIN_MAX_FAILURES=10;
type LockoutStore=Pick<Db,'audit'>;
export function loginKey(email:string){return createHmac('sha256',process.env.JWT_SECRET||'').update('staff-login:'+email.trim().toLowerCase()).digest('hex').slice(0,40);}
export async function loginLocked(db:LockoutStore,key:string,userId?:string,now=new Date()){
 let since=new Date(now.getTime()-LOGIN_WINDOW_MS);
 if(userId){const last=await db.audit.findFirst({where:{action:'LOGIN',resource:'auth',actorId:userId,createdAt:{gt:since}},orderBy:{createdAt:'desc'},select:{createdAt:true}});if(last)since=last.createdAt;}
 const failures=await db.audit.count({where:{action:'LOGIN_FAILED',resource:'auth',resourceId:key,createdAt:{gt:since}}});
 return failures>=LOGIN_MAX_FAILURES;
}
/* Production rows take the database clock, the same clock as the LOGIN rows that reset the count. */
export async function recordLoginFailure(db:LockoutStore,key:string,at?:Date){await db.audit.create({data:{action:'LOGIN_FAILED',resource:'auth',resourceId:key,...(at?{createdAt:at}:{})}});}
@ApiTags('Authentication') @Controller('auth')
export class AuthController {
 constructor(@Inject(Db) private db:Db){}
 @Post('login') @Throttle({default:{limit:5,ttl:60000}})
 async login(@ValidatedBody(LoginDto) body:LoginDto,@Res({passthrough:true}) res:any){const email=body.email.toLowerCase();const lockKey=loginKey(email);const user=await this.db.user.findUnique({where:{email}});if(await loginLocked(this.db,lockKey,user?.id))throw new HttpException('Too many failed sign-in attempts. Try again in 15 minutes.',429);const ok=await compare(body.password,user?.passwordHash||'$2b$12$C6UzMDM.H6dfI/f/IKcEe.2xqE5E5LGaBPa9kJ4QaMBjHHxNB5E2W');if(!user?.active||!ok){await recordLoginFailure(this.db,lockKey);throw new UnauthorizedException('Invalid credentials');}const accessToken=jwt.sign({sub:user.id,v:user.tokenVersion},process.env.JWT_SECRET!,{expiresIn:'2h',algorithm:'HS256'});res.cookie('access_token',accessToken,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',maxAge:7200000,path:'/api'});await this.db.audit.create({data:{actorId:user.id,action:'LOGIN',resource:'auth'}});return {accessToken,user:{id:user.id,email:user.email,name:user.name,role:user.role}};}
 @Get('me') @UseGuards(AuthGuard) @ApiBearerAuth() me(@Req() req:any){return req.user;}
 /* Silent refresh: an active session gets a fresh 2-hour cookie (same token version, so a logout or password change still ends it everywhere). */
 @Post('refresh') @UseGuards(AuthGuard) @Throttle({default:{limit:20,ttl:60000}}) async refresh(@Req() req:any,@Res({passthrough:true}) res:any){const user=await this.db.user.findUnique({where:{id:req.user.id}});if(!user?.active)throw new UnauthorizedException();const accessToken=jwt.sign({sub:user.id,v:user.tokenVersion},process.env.JWT_SECRET!,{expiresIn:'2h',algorithm:'HS256'});res.cookie('access_token',accessToken,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',maxAge:7200000,path:'/api'});return {accessToken,expiresAt:new Date(Date.now()+7200000).toISOString()};}
 @Post('logout') @UseGuards(AuthGuard) async logout(@Req() req:any,@Res({passthrough:true}) res:any){await this.db.user.update({where:{id:req.user.id},data:{tokenVersion:{increment:1}}});res.clearCookie('access_token',{path:'/api'});return {loggedOut:true};}
}
