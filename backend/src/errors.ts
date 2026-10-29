import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
@Catch()
export class Errors implements ExceptionFilter {
 catch(error:any,host:ArgumentsHost){const res=host.switchToHttp().getResponse();
 let status=500,message:any='Internal server error';
 if(error instanceof HttpException){status=error.getStatus();message=error.getResponse();}
 // Express body-parser raises a non-Nest error before controller validation.
 // Keep oversized/malformed client bodies out of the generic 500 path.
 else if(error?.type==='entity.too.large'&&error?.status===413){status=413;message='Request body is too large';}
 else if(error?.type==='entity.parse.failed'&&error?.status===400){status=400;message='Malformed JSON request body';}
 else if(error instanceof Prisma.PrismaClientKnownRequestError){status=error.code==='P2002'?409:error.code==='P2025'?404:400;message=status===409?'Record already exists':status===404?'Record not found':'Invalid database operation';}
 if(status===500) console.error(error);
 res.status(status).json(typeof message==='object'?message:{statusCode:status,message});}
}
