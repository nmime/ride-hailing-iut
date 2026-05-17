const KNOWN_PLACEHOLDERS = new Set([
  'change_me_to_a_long_random_string',
  'ChangeMe123!',
  'admin',
  'password',
]);

export function requiredEnv(name: string, options: { minLength?: number; secret?: boolean } = {}) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  if (options.minLength && value.length < options.minLength) {
    throw new Error(`${name} must be at least ${options.minLength} characters long`);
  }
  if (options.secret && KNOWN_PLACEHOLDERS.has(value)) {
    throw new Error(`${name} must not use a known placeholder value`);
  }
  return value;
}

export function requiredNumberEnv(name: string, options: { min?: number; max?: number } = {}) {
  const raw = requiredEnv(name);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be numeric`);
  if (options.min !== undefined && value < options.min)
    throw new Error(`${name} must be >= ${options.min}`);
  if (options.max !== undefined && value > options.max)
    throw new Error(`${name} must be <= ${options.max}`);
  return value;
}
