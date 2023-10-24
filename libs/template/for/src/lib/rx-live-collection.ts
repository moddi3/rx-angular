import { EmbeddedViewRef, TemplateRef, ViewContainerRef } from '@angular/core';
import { Observable } from 'rxjs';
import { LiveCollection } from './list-reconciliation';
import {
  onStrategy,
  RxStrategyProvider,
} from '@rx-angular/cdk/render-strategies';

type View = EmbeddedViewRef<{ $implicit: unknown; index: number }>;

export class LiveCollectionLContainerImpl extends LiveCollection<
  View,
  unknown
> {
  /**
   Property indicating if indexes in the repeater context need to be updated following the live
   collection changes. Index updates are necessary if and only if views are inserted / removed in
   the middle of LContainer. Adds and removals at the end don't require index updates.
   */
  private needsIndexUpdate = false;
  private workQueue: {
    work$: Observable<unknown>;
    type: 'attach' | 'detach' | 'remove' | 'update';
  }[] = [];

  private _workQueue = new Map<
    View,
    {
      work: Function;
      type: 'attach' | 'detach' | 'remove' | 'update';
      order: number;
    }
  >();
  private _virtualViews: View[];

  constructor(
    private viewContainer: ViewContainerRef,
    private templateRef: TemplateRef<{ $implicit: unknown; index: number }>,
    private strategyProvider: RxStrategyProvider
  ) {
    super();
  }

  exhaustQueue() {
    return Array.from(this._workQueue.values())
      .sort((a, b) => a.order - b.order)
      .map(({ work, order }) => {
        console.log('exec order', order);
        return onStrategy(
          null,
          this.strategyProvider.strategies[
            this.strategyProvider.primaryStrategy
          ],
          () => work()
        );
      });
    /*return this.workQueue.map((i) => i.work$);*/
  }

  override get length(): number {
    return this._virtualViews.length;
    /*this.viewContainer.length + this.lengthAdjustment;*/
  }
  override at(index: number): unknown {
    // console.log('live-coll: at', { index });
    return this.getView(index).context.$implicit;
  }
  override attach(index: number, view: View): void {
    this.needsIndexUpdate ||= index !== this.length;
    addToArray(this._virtualViews, index, view);
    const existingWork = this._workQueue.get(view);
    console.log('live-coll: attach', { index, existingWork });
    this._workQueue.set(view, {
      work: () => {
        existingWork?.work?.call(this);
        this.viewContainer.insert(view, index);
        view.detectChanges();
      },
      order: this._workQueue.get(view)?.order ?? this._workQueue.size + 1,
      type: 'attach',
    });
    /* this.workQueue.push({
      work$: onStrategy(
        null,
        this.strategyProvider.strategies[this.strategyProvider.primaryStrategy],
        () => {
          this.viewContainer.insert(view, index);
          view.detectChanges();
        }
      ),
      type: 'attach',
    });*/
  }
  override detach(index: number): View {
    this.needsIndexUpdate ||= index !== this.length - 1;
    const detachedView = removeFromArray(this._virtualViews, index);
    /*if (this.virtualViews.has(index)) {
      this.lengthAdjustment--;
      const virtualView = this.virtualViews.get(index);
      this.virtualViews.delete(index);
      console.log('live-coll: detach virtual view', { index });
      return virtualView;
    }*/
    const existingWork = this._workQueue.get(detachedView);
    console.log('live-coll: detach', { index, existingWork });
    this._workQueue.set(detachedView, {
      work: () => {
        existingWork?.work?.call(this);
        this.viewContainer.detach(index);
      },
      order: existingWork?.order ?? this._workQueue.size + 1,
      type: 'detach',
    });
    /*this.workQueue.push({
      work$: onStrategy(
        null,
        this.strategyProvider.strategies[this.strategyProvider.primaryStrategy],
        () => {

        }
      ),
      type: 'detach',
    });*/

    return detachedView;
  }
  override create(index: number, value: unknown): View {
    console.log('live-coll: create', { index, value });
    return this.templateRef.createEmbeddedView({ $implicit: value, index });
  }
  override destroy(view: View): void {
    const existingWork = this._workQueue.get(view);
    console.log('live-coll: destroy', { existingWork });
    this._workQueue.set(view, {
      work: () => {
        existingWork?.work?.call(this);
        view.destroy();
        view.detectChanges();
      },
      order: existingWork?.order ?? this._workQueue.size + 1,
      type: 'remove',
    });
    /*this.workQueue.push({
      work$: onStrategy(
        null,
        this.strategyProvider.strategies[this.strategyProvider.primaryStrategy],
        () => {
          view.destroy();
          view.detectChanges();
        }
      ),
      type: 'remove',
    });*/
  }
  override updateValue(index: number, value: unknown): void {
    const view = this.getView(index);
    const existingWork = this._workQueue.get(view);
    console.log('live-coll: updateValue', { index, value, existingWork });
    this._workQueue.set(view, {
      work: () => {
        existingWork?.work?.();
        view.context.$implicit = value;
        view.detectChanges();
      },
      order: existingWork?.order ?? this._workQueue.size + 1,
      type: 'update',
    });
    /* this.workQueue.push({
      work$: onStrategy(
        null,
        this.strategyProvider.strategies[this.strategyProvider.primaryStrategy],
        () => {
          existingWork?.work?.();
          view.context.$implicit = value;
          view.detectChanges();
        }
      ),
      type: 'update',
    });*/
  }

  reset() {
    this.workQueue = [];
    this._virtualViews = [];
    this._workQueue.clear();
    for (let i = 0; i < this.viewContainer.length; i++) {
      this._virtualViews[i] = this.viewContainer.get(i) as View;
    }
    this.needsIndexUpdate = false;
  }

  updateIndexes() {
    if (this.needsIndexUpdate) {
      console.log('live-coll: updateIndexes');
      for (let i = 0; i < this.length; i++) {
        const view = this.getView(i);
        const existingWork = this._workQueue.get(view);
        this._workQueue.set(view, {
          work: () => {
            view.context.index = i;
            if (existingWork) {
              existingWork.work();
            } else {
              view.detectChanges();
            }
          },
          order: existingWork?.order ?? this._workQueue.size + 1,
          type: 'update',
        });
      }
    }
  }

  private getView(index: number): View {
    return this._virtualViews[index] ?? (this.viewContainer.get(index) as View);
  }
}

export function addToArray(arr: any[], index: number, value: any): void {
  // perf: array.push is faster than array.splice!
  if (index >= arr.length) {
    arr.push(value);
  } else {
    arr.splice(index, 0, value);
  }
}

export function removeFromArray(arr: any[], index: number): any {
  // perf: array.pop is faster than array.splice!
  if (index >= arr.length - 1) {
    return arr.pop();
  } else {
    return arr.splice(index, 1)[0];
  }
}
