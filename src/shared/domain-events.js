import { EventEmitter } from 'node:events';

export const domainEvents = new EventEmitter();

// Called by the outer service only after its transaction has committed.
export function notifyChanges(events) {
  for (const event of events) {
    try { domainEvents.emit(event.type, event); }
    catch { console.error('A post-commit notification listener failed.'); }
  }
}
