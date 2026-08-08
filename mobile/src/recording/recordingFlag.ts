// Module-level flag tracking "is a recording currently in flight?".
//
// Why a module flag and not React Context: the Tabs layout's tabBar listeners
// are created once at mount and cannot easily subscribe to React state from a
// sibling tab screen. A plain mutable flag is read at event-fire time, so it
// always sees the latest value.
//
// Anyone with a true reason to know about UI updates can subscribe.

type Listener = (active: boolean) => void;
type DiscardHandler = () => void | Promise<void>;

let active = false;
const listeners = new Set<Listener>();
let discardHandler: DiscardHandler | null = null;

export function setRecordingActive(next: boolean): void {
  if (active === next) return;
  active = next;
  for (const l of listeners) l(next);
}

export function isRecordingActive(): boolean {
  return active;
}

export function subscribeRecordingActive(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The Record screen registers how to actually tear down its recorder. */
export function setRecordingDiscardHandler(h: DiscardHandler | null): void {
  discardHandler = h;
}

export async function triggerDiscardRecording(): Promise<void> {
  if (discardHandler) await discardHandler();
}
