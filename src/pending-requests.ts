import type { AskCompletion } from "./protocol.js";

type PendingRequest = {
  resolve: (completion: AskCompletion) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class PendingRequests {
  private readonly requests = new Map<string, PendingRequest>();

  waitFor(requestId: string, timeoutMs: number): Promise<AskCompletion> {
    if (this.requests.has(requestId)) {
      throw new Error(`duplicate request id: ${requestId}`);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.requests.delete(requestId);
        reject(new Error(`timed out waiting for Claude Code reply to ${requestId}`));
      }, timeoutMs);

      this.requests.set(requestId, { resolve, reject, timeout });
    });
  }

  complete(completion: AskCompletion): boolean {
    const pending = this.requests.get(completion.requestId);
    if (!pending) return false;

    clearTimeout(pending.timeout);
    this.requests.delete(completion.requestId);
    pending.resolve(completion);
    return true;
  }

  cancel(requestId: string, error: Error): boolean {
    const pending = this.requests.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timeout);
    this.requests.delete(requestId);
    pending.reject(error);
    return true;
  }

  rejectAll(error: Error): void {
    for (const [requestId, pending] of this.requests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.requests.delete(requestId);
    }
  }
}
