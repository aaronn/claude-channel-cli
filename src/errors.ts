export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class HttpError extends AppError {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class RequestTimeoutError extends AppError {}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
