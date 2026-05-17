export interface RequiredEnvOptions {
  minLength?: number;
  secret?: boolean;
}

export interface RequiredNumberEnvOptions {
  min?: number;
  max?: number;
}

export function requiredEnv(name: string, options: RequiredEnvOptions = {}) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  if (options.minLength && value.length < options.minLength) {
    throw new Error(`${name} must be at least ${options.minLength} characters long`);
  }
  if (options.secret && value.trim() !== value) {
    throw new Error(`${name} must not contain leading or trailing whitespace`);
  }
  return value;
}

export function requiredNumberEnv(name: string, options: RequiredNumberEnvOptions = {}) {
  const raw = requiredEnv(name);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be numeric`);
  if (options.min !== undefined && value < options.min) {
    throw new Error(`${name} must be >= ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new Error(`${name} must be <= ${options.max}`);
  }
  return value;
}
