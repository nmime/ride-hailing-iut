export function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

export function requiredNumberEnv(name: string) {
  const value = Number(requiredEnv(name));
  if (!Number.isFinite(value)) throw new Error(`${name} must be numeric`);
  return value;
}
