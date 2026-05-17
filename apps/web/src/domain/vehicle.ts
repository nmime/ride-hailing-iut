import type { CreateVehicleBody, Vehicle } from '../api/client';

export const VEHICLE_LIMITS = {
  plate: { min: 3, max: 16 },
  text: { min: 1, max: 64 },
  color: { min: 1, max: 32 },
  year: { min: 1990, max: 2100 },
  capacity: { min: 1, max: 8 },
} as const;

export function emptyVehicleDraft(): CreateVehicleBody {
  return {
    plate: '',
    make: '',
    model: '',
    year: new Date().getFullYear(),
    color: 'White',
    capacity: 4,
  };
}

export function normalizeVehicleDraft(draft: CreateVehicleBody): CreateVehicleBody {
  return {
    plate: draft.plate.trim().toUpperCase(),
    make: draft.make.trim(),
    model: draft.model.trim(),
    year: draft.year,
    color: draft.color.trim(),
    capacity: draft.capacity,
  };
}

export function vehicleSummary(vehicle: Pick<Vehicle, 'make' | 'model' | 'year' | 'color'>) {
  return `${vehicle.make} ${vehicle.model} · ${vehicle.year} · ${vehicle.color}`;
}
