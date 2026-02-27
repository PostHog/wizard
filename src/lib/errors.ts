/**
 * Error that has already been displayed to the user via clack.
 * Callers can skip redundant error logging when catching this.
 */
export class DisplayedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DisplayedError';
  }
}
