type Handler<T> = (payload: T) => void;

/**
 * Minimal typed pub/sub. Used to keep the UI layer completely decoupled from
 * the game loop - the loop never touches the DOM, the UI never touches Three.
 */
export class EventBus<Events extends object> {
  private readonly handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => set!.delete(handler as Handler<never>);
  }

  once<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        (handler as Handler<Events[K]>)(payload);
      } catch (err) {
        console.error(`[eventBus] handler for "${String(event)}" threw`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
