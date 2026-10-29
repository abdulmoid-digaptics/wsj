import {frontendOrigins} from './origins';
import { Injectable, OnModuleInit, OnModuleDestroy, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException, SetMetadata, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
@Injectable()
export class Db extends PrismaClient implements OnModuleInit, OnModuleDestroy {
 async onModuleInit(){ await this.$connect(); }
 async onModuleDestroy(){ await this.$disconnect(); }
}
export const Roles = (...roles:string[]) => SetMetadata('roles',roles);

export function parsePagination(q: any, defaultLimit = 10, maxLimit = 100) {
  const page = Math.max(1, parseInt(String(q?.page ?? 1), 10) || 1);
  const rawLimit = parseInt(String(q?.limit ?? defaultLimit), 10) || defaultLimit;
  const limit = Math.max(1, Math.min(maxLimit, rawLimit));
  const search = typeof q?.search === 'string' && q.search.trim().length > 0 ? q.search.trim() : undefined;
  const status = typeof q?.status === 'string' && q.status.trim().length > 0 ? q.status.trim() : undefined;
  return { page, limit, skip: (page - 1) * limit, take: limit, search, status };
}
@Injectable()
export class AuthGuard implements CanActivate {
 constructor(@Inject(Db) private db:Db,@Inject(Reflector) private reflector:Reflector){}
 async canActivate(ctx:ExecutionContext){
  const req=ctx.switchToHttp().getRequest(); const bearer=req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7):null;
  const token=bearer || req.cookies?.access_token;
  if(!token) throw new UnauthorizedException();
  try { const payload=jwt.verify(token,process.env.JWT_SECRET!) as jwt.JwtPayload; const user=await this.db.user.findUnique({where:{id:payload.sub}});
   if(!user?.active || user.tokenVersion!==payload.v) throw new Error();
   req.user={id:user.id,email:user.email,name:user.name,role:user.role};
  } catch {throw new UnauthorizedException('Invalid or expired session');}
  const roles=this.reflector.getAllAndOverride<string[]>('roles',[ctx.getHandler(),ctx.getClass()]);
  if(roles && !roles.includes(req.user.role)) throw new ForbiddenException();
  if(!bearer && !['GET','HEAD','OPTIONS'].includes(req.method)) { const origin=req.headers.origin; if(!frontendOrigins().includes(origin)) throw new ForbiddenException('Origin required for cookie-authenticated writes'); }
  return true;
 }
}
