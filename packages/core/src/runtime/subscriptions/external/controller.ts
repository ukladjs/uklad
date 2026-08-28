import type { ExternalSubscriptionContext, ExternalSubscriptionDriver } from './types';

/**
 * Owns the stateful part of one external node.
 *
 * Subscription cells retain only ordinary value/error/version state. Input
 * stamps, reconciliation debt, and the driver lifecycle remain isolated here.
 */
export class ExternalSubscriptionController<TResult> {
  private readonly driver: ExternalSubscriptionDriver<readonly unknown[], TResult>;
  private latestInputs: readonly unknown[] = [];
  private inputsUsable = true;
  private syncPending = false;
  private activationStarted = false;
  private disposed = false;

  constructor(driver: ExternalSubscriptionDriver<readonly unknown[], TResult>) {
    this.driver = driver;
  }

  updateInputs(inputs: readonly unknown[], inputsChanged: boolean, usable: boolean): void {
    this.latestInputs = inputs;
    this.inputsUsable = usable;
    if (inputsChanged) this.syncPending = true;
  }

  read(): TResult {
    return this.driver.read(this.latestInputs);
  }

  get needsSync(): boolean {
    return this.syncPending && this.inputsUsable && !this.disposed;
  }

  sync(): void {
    if (!this.needsSync) return;
    this.driver.sync(this.latestInputs);
    this.syncPending = false;
  }

  activate(invalidate: () => void): void {
    if (this.disposed || this.activationStarted) return;
    this.activationStarted = true;
    const context: ExternalSubscriptionContext = Object.freeze({ invalidate });
    this.driver.activate(this.latestInputs, context);
    // Activation binds the driver to the latest dormant tuple. Any subsequent
    // dependency change will establish fresh reconciliation debt.
    this.syncPending = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.driver.dispose();
  }
}
