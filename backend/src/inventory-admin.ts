import {BadRequestException, ConflictException, Controller, Get, Inject, Param, Post, Req, UseGuards} from '@nestjs/common';
import {ApiBearerAuth} from '@nestjs/swagger';
import {IsArray, ArrayNotEmpty, ArrayUnique, IsInt, IsString, IsUUID, Max, MaxLength, Min, MinLength, Matches} from 'class-validator';
import {randomUUID} from 'node:crypto';
import {Db, AuthGuard, Roles} from './core';
import {ValidatedBody} from './validation';
import {audit} from './admin';
import {InventoryError, ResourceInventory} from './resource-inventory';

class LocationInput {
 @IsString() @MinLength(1) @MaxLength(120) name!: string;
 @IsString() @MinLength(1) @MaxLength(100) timeZone!: string;
}
class ResourceInput {
 @IsUUID() locationId!: string;
 @IsString() @MinLength(1) @MaxLength(120) name!: string;
 @IsString() @MinLength(1) @MaxLength(100) kind!: string;
 @IsInt() @Min(1) @Max(10000) capacity!: number;
}
class MapInput {
 @IsUUID() serviceId!: string;
}
class ClosureInput {
 @IsUUID() locationId!: string;
 @IsString() @Matches(/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/) startsAt!: string;
 @IsString() @Matches(/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/) endsAt!: string;
 @IsArray() @ArrayNotEmpty() @ArrayUnique() @IsUUID('4',{each:true}) resourceIds!: string[];
}

/** Administrative configuration. Only explicit physical resources may be closed. */
@ApiBearerAuth() @UseGuards(AuthGuard) @Controller('admin/inventory')
export class InventoryAdminController {
 constructor(@Inject(Db) private readonly db: Db) {}
 @Get('locations')
 async locations() {return this.db.inventoryLocation.findMany({orderBy:{name:'asc'},include:{resources:{orderBy:{name:'asc'},include:{mappings:{include:{service:{select:{id:true,name:true,slug:true}}}}}}}});}
 @Post('locations') @Roles('ADMIN')
 async createLocation(@ValidatedBody(LocationInput) dto:LocationInput,@Req() req:any) {
  const name=dto.name.trim();if(!name)throw new BadRequestException('Name is required');
  try{new Intl.DateTimeFormat('en-US',{timeZone:dto.timeZone}).format();}catch{throw new BadRequestException('Select a valid IANA time zone');}
  const item=await this.db.inventoryLocation.create({data:{name,timeZone:dto.timeZone}});
  await audit(this.db,req,'CREATE','inventory-location',item.id);return item;
 }
 @Post('resources') @Roles('ADMIN')
 async createResource(@ValidatedBody(ResourceInput) dto:ResourceInput,@Req() req:any) {
  const name=dto.name.trim(),kind=dto.kind.trim();if(!name||!kind)throw new BadRequestException('Name and kind are required');
  if(!await this.db.inventoryLocation.findUnique({where:{id:dto.locationId},select:{id:true}}))throw new BadRequestException('Unknown location');
  const item=await this.db.physicalResource.create({data:{locationId:dto.locationId,name,kind,capacity:dto.capacity}});
  await audit(this.db,req,'CREATE','physical-resource',item.id);return item;
 }
 @Post('resources/:id/mappings') @Roles('ADMIN')
 async mapService(@Param('id') id:string,@ValidatedBody(MapInput) dto:MapInput,@Req() req:any) {
  const [resource,service]=await Promise.all([this.db.physicalResource.findUnique({where:{id},select:{id:true}}),this.db.serviceCategory.findUnique({where:{id:dto.serviceId},select:{id:true}})]);
  if(!resource||!service)throw new BadRequestException('Unknown resource or service');
  const item=await this.db.resourceServiceMapping.upsert({where:{resourceId_serviceId:{resourceId:id,serviceId:dto.serviceId}},create:{resourceId:id,serviceId:dto.serviceId},update:{}});
  await audit(this.db,req,'CREATE','resource-service-mapping',id);return item;
 }
 @Post('closures') @Roles('ADMIN','EDITOR')
 async close(@ValidatedBody(ClosureInput) dto:ClosureInput,@Req() req:any) {
  const startsAt=new Date(dto.startsAt),endsAt=new Date(dto.endsAt);
  if(!Number.isFinite(+startsAt)||!Number.isFinite(+endsAt)||startsAt>=endsAt)throw new BadRequestException('Invalid closure interval');
  if(dto.resourceIds.length>64)throw new BadRequestException('A closure can include at most 64 resources');
  try {
   const result=await new ResourceInventory(this.db).close({locationId:dto.locationId,startsAt,endsAt,resourceIds:dto.resourceIds,ownerRef:'admin-closure:'+randomUUID()});
   await audit(this.db,req,'CREATE','inventory-closure',result.id);return result;
  } catch(error) {
   if(error instanceof InventoryError){if(error.code==='UNAVAILABLE')throw new ConflictException('Selected resources have a conflicting reservation or closure');throw new BadRequestException(error.message);}
   throw error;
  }
 }
}
