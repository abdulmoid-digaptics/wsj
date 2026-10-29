import {ValidatedBody} from './validation';
import {Controller,Get,Post,Req,Res,UseGuards,UnauthorizedException,Inject} from '@nestjs/common';
import {Throttle} from '@nestjs/throttler';
import {ApiTags,ApiBearerAuth} from '@nestjs/swagger';
import {compare} from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {Db,AuthGuard} from './core';
import {LoginDto} from './dto';
@ApiTags('Authentication') @Controller('auth')
export class AuthController {
 constructor(@Inject(Db) private db:Db){}
 @Post('login') @Throttle({default:{limit:5,ttl:60000}})
 async login(@ValidatedBody(LoginDto) body:LoginDto,@Res({passthrough:true}) res:any){const user=await this.db.user.findUnique({where:{email:body.email.toLowerCase()}});const ok=await compare(body.password,user?.passwordHash||'$2b$12$C6UzMDM.H6dfI/f/IKcEe.2xqE5E5LGaBPa9kJ4QaMBjHHxNB5E2W');if(!user?.active||!ok)throw new UnauthorizedException('Invalid credentials');const accessToken=jwt.sign({sub:user.id,v:user.tokenVersion},process.env.JWT_SECRET!,{expiresIn:'2h'});res.cookie('access_token',accessToken,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',maxAge:7200000,path:'/api'});await this.db.audit.create({data:{actorId:user.id,action:'LOGIN',resource:'auth'}});return {accessToken,user:{id:user.id,email:user.email,name:user.name,role:user.role}};}
 @Get('me') @UseGuards(AuthGuard) @ApiBearerAuth() me(@Req() req:any){return req.user;}
 @Post('logout') @UseGuards(AuthGuard) async logout(@Req() req:any,@Res({passthrough:true}) res:any){await this.db.user.update({where:{id:req.user.id},data:{tokenVersion:{increment:1}}});res.clearCookie('access_token',{path:'/api'});return {loggedOut:true};}
}
