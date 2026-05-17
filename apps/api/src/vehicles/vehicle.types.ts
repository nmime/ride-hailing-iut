export interface VehicleRow {
  id: string;
  driver_id: string;
  plate: string;
  make: string;
  model: string;
  year: number;
  color: string;
  capacity: number;
  is_active: boolean;
  created_at: Date;
}
