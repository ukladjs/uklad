import isEqual from 'fast-deep-equal'
import { consoleLog } from './loggers'
import type { Id, SubVector, Watcher, EqualityCheckFn } from './types'
import { withTrace, mergeTrace } from './trace'

// Monotonic id per refreshIfStale entry point. Shared dependencies in diamond
// graphs are validated once per pass instead of once per path.
let refreshPassCounter = 0
// Changes only invalidate within-pass probe deduplication. Freshness itself is
// still derived exclusively from root identity and dependency versions.
let sourceSignalCounter = 0

export class Reaction<T> {
  private id: Id = ''
  private computeFn: (...depValues: any[]) => T
  private deps: Reaction<any>[] | undefined
  private dependents = new Set<Reaction<any>>()
  private watchers: Array<Watcher<T>> = []
  private scheduled = false
  private scheduleToken = 0
  private value: T | undefined = undefined
  private hasValue = false
  private version = 0
  private lastNotifiedVersion = 0
  private depsVersions: number[] = []
  private subVector: SubVector | undefined
  private equalityCheck: EqualityCheckFn
  private lastRefreshPass = 0
  private lastRefreshSignal = 0
  private lastProbePass = 0
  private lastProbeResult = true
  private onDispose?: () => void
  private onRevive?: () => void
  private resolveDeps?: () => Reaction<any>[]

  constructor(computeFn: (...depValues: any[]) => T, deps?: Reaction<any>[], equalityCheck?: EqualityCheckFn) {
    this.computeFn = computeFn
    this.deps = deps
    this.equalityCheck = equalityCheck || isEqual
  }

  static create<R>(fn: (...values: any[]) => R, deps?: Reaction<any>[], equalityCheck?: EqualityCheckFn): Reaction<R> {
    return new Reaction(fn, deps, equalityCheck)
  }

  computeValue(): T {
    this.refreshIfStale()
    return this.value as T
  }

  getValue(): T {
    return this.value as T
  }

  getDepValue(notifyWatchers: boolean = true): [T, number] {
    this.refreshIfStaleInternal(notifyWatchers, ++refreshPassCounter)
    return [this.value as T, this.version]
  }

  /**
   * Read the current value with external-store snapshot semantics:
   * ordinary reads of an alive reaction use its cached value, while dormant
   * or never-evaluated reactions validate through the dependency chain. A
   * separate explicit pull may advance an alive cache, but cannot consume an
   * already-scheduled watcher notification.
   */
  getSnapshot(): T {
    if (!this.isAlive || !this.hasValue) {
      this.refreshIfStale()
    }
    return this.value as T
  }

  /**
   * Bring the cached value up to date only if something underneath actually
   * changed, without recomputing a chain that is already fresh. Roots verify
   * with a cheap identity check against their source; computed reactions
   * compare dependency versions. Each entry starts a refresh pass, so shared
   * dependencies reached through several paths validate only once.
   */
  refreshIfStale(pass: number = ++refreshPassCounter): void {
    this.refreshIfStaleInternal(false, pass)
  }

  /**
   * Refresh from source identity/dependency versions. Notification delivery is
   * intentionally independent from evaluation: a silent pull may advance the
   * value, but an already-scheduled watcher notification remains pending until
   * `lastNotifiedVersion` catches up.
   */
  private refreshIfStaleInternal(notifyWatchers: boolean, pass: number): void {
    const sourceSignal = sourceSignalCounter
    if (this.lastRefreshPass === pass && this.lastRefreshSignal === sourceSignal) {
      if (notifyWatchers) {
        this.cancelScheduledRecompute()
        this.notifyWatchersIfNeeded()
      } else {
        this.acknowledgeSilentRead()
      }
      return
    }
    this.lastRefreshPass = pass
    this.lastRefreshSignal = sourceSignal

    try {
      if (this.isRoot) {
        // A root compute function is a cheap source read. Object identity is
        // the root's version probe; immutable db updates give changed slices a
        // new identity and preserve identity for untouched slices.
        this.evaluate()
      } else {
        if (this.deps) {
          for (const dependency of this.deps) {
            dependency.refreshIfStaleInternal(notifyWatchers, pass)
          }
        }

        const currentVersions = this.deps?.map(dependency => dependency.getVersion()) ?? []
        if (!this.hasValue || !isEqual(currentVersions, this.depsVersions)) {
          this.evaluate(currentVersions)
        }
      }

      if (notifyWatchers) {
        // This refresh fully satisfies any task previously queued for this
        // reaction. Cancel before callbacks so a re-entrant markDirty can
        // safely schedule a distinct follow-up task.
        this.cancelScheduledRecompute()
        this.notifyWatchersIfNeeded()
      } else {
        this.acknowledgeSilentRead()
      }
    } catch (error) {
      consoleLog('error', `[reflex] Error in reaction computation ${this.id}:`, error)
      throw error
    }
  }

  watch(callback: (val: T) => void, componentName: string = "react component") {
    const idx = this.watchers.findIndex(w => w.callback === callback)
    if (idx === -1) {
      const hadWatchers = this.hasWatchers
      const wasAlive = this.isAlive
      this.watchers.push({ callback, componentName })
      if (!wasAlive) {
        this.goLive()
      }
      if (this.deps) {
        for (const d of this.deps) d.ensureAliveWith(this)
      }
      if (!wasAlive && this.hasValue) {
        // The reaction was not receiving markDirty propagation until now, so
        // its cached value may predate events dispatched since it was last
        // read (e.g. between a component's render and its subscription).
        // Refresh so the post-subscribe snapshot check sees current data.
        // Never-computed reactions stay lazy: the first read computes anyway.
        this.refreshIfStale()
      }
      // The first watcher starts from the snapshot visible at subscription
      // time. Do not acknowledge while a scheduled change is pending: that
      // task still owes the new watcher a post-change callback.
      if (!hadWatchers && !this.scheduled) {
        this.lastNotifiedVersion = this.version
      }
    }
  }

  /**
   * Called on the not-alive -> alive transition. Dependencies cached from
   * creation time may have been disposed and replaced in the registry while
   * this reaction was dormant; re-resolve them so live reactions always link
   * to the registered instances (the only ones the db wake-up path can find),
   * and re-register this reaction itself.
   */
  private goLive() {
    if (this.resolveDeps && !this.isRoot) {
      const newDeps = this.resolveDeps()
      const changed = !this.deps
        || newDeps.length !== this.deps.length
        || newDeps.some((d, i) => d !== this.deps![i])
      if (changed) {
        this.deps = newDeps
        // Fresh dep instances restart version counters; invalidate recorded
        // versions so the next refresh recomputes instead of trusting a
        // coincidental version match against different objects.
        this.depsVersions = []
      }
    }
    this.onRevive?.()
  }

  unwatch(fn: (v: T) => void) {
    const idx = this.watchers.findIndex(w => w.callback === fn)
    if (idx !== -1) {
      this.watchers.splice(idx, 1)
      if (this.watchers.length === 0) {
        this.disposeIfUnused()
      }
    }
  }

  markDirty() {
    sourceSignalCounter++
    this.propagateSignal()
  }

  private propagateSignal() {
    for (const dependent of this.dependents) dependent.propagateSignal()
    // Dependencies are refreshed by watcher-bearing descendants. Scheduling
    // nodes with no watchers would only duplicate source probes.
    if (!this.hasWatchers) { return }
    this.scheduleRecompute()
  }

  private scheduleRecompute() {
    if (this.scheduled) return
    this.scheduled = true
    const token = ++this.scheduleToken
    queueMicrotask(() => {
      if (token !== this.scheduleToken) return
      this.scheduled = false
      if (!this.isAlive) return
      this.refreshIfStaleInternal(true, ++refreshPassCounter)
    })
  }

  private evaluate(currentVersions?: number[]) {
    let changed = false

    withTrace(
      {
        operation: this.subVector?.[0] ?? '',
        opType: 'sub/run',
        tags: {
          queryV: this.subVector,
          reaction: this.id,
          deps: this.deps?.map(dependency => dependency.getId()) ?? [],
        },
      },
      () => {
        if (this.isRoot) {
          const newValue = this.computeFn()
          changed = !this.hasValue || !Object.is(newValue, this.value)
          if (changed) {
            this.value = newValue
          }
          this.hasValue = true
        } else {
          const values = this.deps?.map(dependency => dependency.getValue()) ?? []
          const newValue = this.computeFn(...values)
          changed = !this.hasValue || !this.equalityCheck(newValue, this.value)
          if (changed) {
            this.value = newValue
          }
          this.hasValue = true
          this.depsVersions = currentVersions ?? []
        }

        if (changed) {
          this.version++
        }
        mergeTrace({ tags: { 'cached?': !changed, 'version': this.version } })
      },
    )
  }

  private notifyWatchersIfNeeded() {
    if (!this.hasValue || this.version === this.lastNotifiedVersion) return

    const notifiedVersion = this.version
    const notifiedValue = this.value as T
    const watchers = this.watchers.slice()
    // A callback may synchronously read or even update this reaction. Record
    // the delivered generation first so re-entrant work can create a distinct
    // pending version instead of delivering this one twice.
    this.lastNotifiedVersion = notifiedVersion

    for (const watcher of watchers) {
      try {
        withTrace(
          {
            opType: 'render',
            operation: watcher.componentName,
            tags: { reaction: this.id },
          },
          () => {
            watcher.callback(notifiedValue)
          },
        )
      } catch (error) {
        consoleLog('error', '[reflex] Error in reaction watcher:', error)
      }
    }
  }

  private acknowledgeSilentRead() {
    if (!this.scheduled) {
      this.lastNotifiedVersion = this.version
    }
  }

  private cancelScheduledRecompute() {
    if (!this.scheduled) return
    this.scheduled = false
    this.scheduleToken++
  }

  /**
   * Synchronously recompute this reaction and its alive dependents, notifying
   * watchers along the way. Used by the dispatchSync flush path; the microtask
   * recomputes that markDirty scheduled become no-ops afterwards. Order is
   * irrelevant: recomputes pull their dependencies, and revisits through
   * diamond graphs are no-ops once clean.
   */
  recomputeTreeSync(): void {
    this.recomputeTreeSyncWithPass(++refreshPassCounter)
  }

  private recomputeTreeSyncWithPass(pass: number): void {
    if (!this.isAlive) {
      return
    }
    this.refreshIfStaleInternal(true, pass)
    for (const dependent of this.dependents) dependent.recomputeTreeSyncWithPass(pass)
  }

  private ensureAliveWith(child: Reaction<any>) {
    const wasAlive = this.isAlive
    this.dependents.add(child)
    if (!wasAlive) {
      this.goLive()
    }
    if (this.deps) {
      for (const d of this.deps) d.ensureAliveWith(this)
    }
  }

  private disposeIfUnused() {
    if (this.isAlive) return
    
    this.depsVersions = []
    this.cancelScheduledRecompute()
    this.lastNotifiedVersion = this.version

    withTrace(
      {
        operation: this.subVector?.[0] ?? '',
        opType: 'sub/dispose',
        tags: {
          queryV: this.subVector,
          reaction: this.id,
        },
      },
      () => {
        if (this.deps) {
          for (const d of this.deps) {
            d.dependents.delete(this)
            d.disposeIfUnused()
          }
        }
      }
    );

    this.onDispose?.()
  }

  setOnDispose(callback: () => void) {
    this.onDispose = callback
  }

  setOnRevive(callback: () => void) {
    this.onRevive = callback
  }

  setDepsResolver(resolver: () => Reaction<any>[]) {
    this.resolveDeps = resolver
  }

  setId(id: Id) {
    this.id = id
  }

  getId(): Id {
    return this.id
  }
  
  getVersion(): number {
    return this.version
  }

  getSubVector(): SubVector | undefined {
    return this.subVector
  }

  setSubVector(subVector: SubVector) {
    this.subVector = subVector
  }

  get hasWatchers(): boolean {
    return this.watchers.length > 0
  }

  get hasDependents(): boolean {
    return this.dependents.size > 0
  }

  get isAlive(): boolean {
    return this.hasWatchers || this.hasDependents
  }

  /**
   * Whether evaluation may advance this reaction. This is a derived probe,
   * not stored state; a never-evaluated reaction has unknown freshness and is
   * therefore reported as dirty.
   */
  get isDirty(): boolean {
    return this.probeIsStale(++refreshPassCounter)
  }

  /** @deprecated Freshness is derived from source/dependency versions. */
  get isInvalidated(): boolean {
    return this.isDirty
  }

  private probeIsStale(pass: number): boolean {
    if (this.lastProbePass === pass) {
      return this.lastProbeResult
    }
    this.lastProbePass = pass

    if (!this.hasValue) {
      this.lastProbeResult = true
    } else if (this.isRoot) {
      this.lastProbeResult = !Object.is(this.computeFn(), this.value)
    } else {
      const dependencyMayBeStale = this.deps?.some(dependency => dependency.probeIsStale(pass)) ?? false
      const currentVersions = this.deps?.map(dependency => dependency.getVersion()) ?? []
      this.lastProbeResult = dependencyMayBeStale || !isEqual(currentVersions, this.depsVersions)
    }

    return this.lastProbeResult
  }

  get isRoot(): boolean {
    return this.deps === undefined || this.deps.length === 0
  }
}
