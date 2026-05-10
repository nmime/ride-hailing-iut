import {
  Controller, Get, Post, Param, Body, Query, HttpCode, Req,
  DefaultValuePipe, HttpStatus, ParseIntPipe, ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth,
} from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';

import { CreateTripDto } from './dto/create-trip.dto';
import { RateTripDto } from './dto/rate-trip.dto';
import { TripsService } from './trips.service';
import { Roles } from '../auth/jwt.guard';

const UUID_PIPE = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY });
const LIMIT_PIPE = new ParseIntPipe({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY });

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
  list(
    @Req() req: FastifyRequest,
    @Query('status') status?: string,
    @Query('limit', new DefaultValuePipe(50), LIMIT_PIPE) limit?: number,
  ) {
    return this.trips.list({ status, limit: limit ?? 50, actor: req.user! });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single trip by id' })
  @ApiParam({ name: 'id', description: 'Trip UUID' })
  @ApiResponse({ status: 404, description: 'Not found' })
  byId(@Param('id', UUID_PIPE) id: string, @Req() req: FastifyRequest) {
    return this.trips.byId(id, req.user!);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a trip (rider or driver)' })
  cancel(@Param('id', UUID_PIPE) id: string, @Req() req: FastifyRequest) {
    return this.trips.cancel(id, req.user!.sub, req.user!.role);
  }

  @Post(':id/start')
  @Roles('driver')
  @HttpCode(200)
  @ApiOperation({ summary: 'Matched driver starts the trip' })
  start(@Param('id', UUID_PIPE) id: string, @Req() req: FastifyRequest) {
    return this.trips.start(id, req.user!);
  }

  @Post(':id/complete')
  @Roles('driver')
  @HttpCode(200)
  @ApiOperation({ summary: 'Matched driver completes the trip and records fare' })
  complete(@Param('id', UUID_PIPE) id: string, @Req() req: FastifyRequest) {
    return this.trips.complete(id, req.user!);
  }

  @Post(':id/rating')
  @Roles('rider')
  @HttpCode(201)
  @ApiOperation({ summary: 'Rider rates the driver after a completed trip (1-5)' })
  @ApiResponse({ status: 409, description: 'trip already rated' })
  rate(
    @Param('id', UUID_PIPE) id: string,
    @Body() dto: RateTripDto,
    @Req() req: FastifyRequest,
  ) {
    return this.trips.rate(id, req.user!.sub, dto);
  }
}
