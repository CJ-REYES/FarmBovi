import { SyncEngine } from './sync-engine';

export const SyncScheduler = {
  intervalId: null as number | null,

  start(intervalMs: number = 45000) {
    if (this.intervalId !== null) return;

    // Evento push nativo (Reconexión de Wi-Fi o Datos Celulares)
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.trigger);
    }

    // Fallback de latidos periódicos (Heartbeat Polling)
    this.intervalId = window.setInterval(() => {
      void this.trigger();
    }, intervalMs);

    // Disparo inicial
    void this.trigger();
  },

  stop() {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.trigger);
    }
  },

  async trigger() {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      await SyncEngine.sync();
    }
  }
};
