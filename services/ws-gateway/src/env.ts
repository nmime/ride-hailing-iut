export function requiredEnv(name: string, options: { minLength?: number; secret?: boolean } = {}) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  if (options.minLength && value.length < options.minLength) {
    throw new Error(`${name} must be at least ${options.minLength} characters long`);
  }
  if (options.secret && ['change_me_to_a_long_random_string', 'ChangeMe123!'].includes(value)) {
    throw new Error(`${name} must not use a known placeholder value`);
  }
  return value;
}

export function requiredNumberEnv(name: string) {
  const value = Number(requiredEnv(name));
  if (!Number.isFinite(value)) throw new Error(`${name} must be numeric`);
  return value;
}
