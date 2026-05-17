import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { Roles } from '../auth/jwt.guard';
import { CreateVehicleDto, UpdateVehicleDto } from './vehicle.dto';
import { VehiclesService } from './vehicles.service';

const UUID_PIPE = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY });

@ApiTags('vehicles')
@ApiBearerAuth()
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Roles('driver')
  @Get()
  @ApiOperation({ summary: 'List the caller-driver vehicles' })
  list(@Req() req: FastifyRequest) {
    return this.vehicles.list(req.user!.sub);
  }

  @Roles('driver')
  @Post()
  @ApiOperation({ summary: 'Register a new vehicle for the caller-driver' })
  create(@Req() req: FastifyRequest, @Body() dto: CreateVehicleDto) {
    return this.vehicles.create(req.user!.sub, dto);
  }

  @Roles('driver')
  @Patch(':id')
  @ApiOperation({ summary: 'Update an existing vehicle' })
  update(
    @Req() req: FastifyRequest,
    @Param('id', UUID_PIPE) id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.vehicles.update(req.user!.sub, id, dto);
  }

  @Roles('driver')
  @Delete(':id')
  @ApiOperation({ summary: 'Remove a vehicle from the caller-driver' })
  remove(@Req() req: FastifyRequest, @Param('id', UUID_PIPE) id: string) {
    return this.vehicles.remove(req.user!.sub, id);
  }
}
