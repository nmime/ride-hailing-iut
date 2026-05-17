import type { JwtPayload } from './auth.service';

export type DemoRole = JwtPayload['role'];

export interface DemoUser {
  role: DemoRole;
  name: string;
  phone: string;
}

export const SEEDED_DEMO_USERS: readonly DemoUser[] = [
  { role: 'admin', name: 'Demo Admin', phone: '+998900000000' },
  { role: 'rider', name: 'Aziza Rider', phone: '+998901111111' },
  { role: 'rider', name: 'Bekzod Rider', phone: '+998902222222' },
  { role: 'driver', name: 'Davron Driver', phone: '+998903333333' },
  { role: 'driver', name: 'Eldor Driver', phone: '+998904444444' },
  { role: 'driver', name: 'Farhod Driver', phone: '+998905555555' },
] as const;

export function demoPhonesFromEnv(raw = process.env.RIDEX_DEMO_LOGIN_PHONES) {
  const phones = (raw ?? '')
    .split(',')
    .map((phone) => phone.trim())
    .filter(Boolean);
  return new Set(phones);
}
