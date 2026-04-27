import {
  Controller, Get, Post, Param, Body, Query, HttpCode, Req,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth,
} from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';

import { CreateTripDto } from './dto/create-trip.dto';
import { TripsService } from './trips.service';
import { Roles } from '../auth/jwt.guard';

@ApiTags('trips')
@ApiBearerAuth()
@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Post()
  @Roles('rider')
  @HttpCode(201)
  @ApiOperation({ summary: 'Rider requests a new trip' })
  @ApiResponse({ status: 201, description: 'Trip created in `requested` state' })
  @ApiResponse({ status: 422, description: 'Invalid pickup or dropoff' })
  create(@Body() dto: CreateTripDto, @Req() req: FastifyRequest) {
    return this.trips.create(dto, req.user!.sub);
  }

  @Get()
  @ApiOperation({ summary: 'List trips visible to the caller' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'limit',  required: false, type: Number })
  list(@Query('status') status?: string, @Query('limit') limit?: number) {
    return this.trips.list({ status, limit: Number(limit ?? 50) });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single trip by id' })
  @ApiParam({ name: 'id', description: 'Trip UUID' })
  @ApiResponse({ status: 404, description: 'Not found' })
  byId(@Param('id') id: string) {
    return this.trips.byId(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a trip (rider or driver)' })
  cancel(@Param('id') id: string, @Req() req: FastifyRequest) {
    return this.trips.cancel(id, req.user!.sub, req.user!.role);
  }
}
