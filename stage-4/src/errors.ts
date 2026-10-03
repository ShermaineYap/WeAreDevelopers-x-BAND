/** An error that maps directly onto the §5 error envelope. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }

  toBody(): { error: { code: string; message: string } } {
    return { error: { code: this.code, message: this.message } };
  }
}

export const malformed = (message: string) => new ApiError(400, 'malformed_request', message);
export const missingIdempotencyKey = () =>
  new ApiError(400, 'missing_idempotency_key', 'The Idempotency-Key header is required');
export const unauthenticated = (message = 'A valid bearer token is required') =>
  new ApiError(401, 'unauthenticated', message);
export const notFound = (message = 'No such resource') => new ApiError(404, 'not_found', message);
export const validationFailed = (message: string) => new ApiError(422, 'validation_failed', message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const unprocessable = (code: string, message: string) => new ApiError(422, code, message);
