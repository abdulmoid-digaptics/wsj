import {Body, Query, ValidationPipe} from '@nestjs/common';
import type {Type} from '@nestjs/common';

// Pin the DTO class explicitly: dev transpilers may omit design:paramtypes.
function dtoValidationPipe<T>(dto: Type<T>): ValidationPipe {
 // See main.ts: implicit conversion is off everywhere. Array/Boolean fields
 // without an explicit @Type must not be silently coerced from the wrong
 // input type; explicit @Type(()=>Number)/@IsDateString fields are unaffected.
 return new ValidationPipe({
  expectedType: dto,
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: {enableImplicitConversion: false},
 });
}

export function ValidatedBody<T>(dto: Type<T>): ParameterDecorator {
 return Body(dtoValidationPipe(dto));
}

export function ValidatedQuery<T>(dto: Type<T>): ParameterDecorator {
 return Query(dtoValidationPipe(dto));
}
