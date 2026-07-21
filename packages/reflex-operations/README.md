# @flexsurfer/reflex-operations

Optional, runtime-local operation receipts for `@flexsurfer/reflex`.

```ts
import {
  createOperationClient,
  createOperationInspector,
} from '@flexsurfer/reflex-operations';

const operations = createOperationClient(runtime);
const { operation } = await operations.dispatchAndWait(['todos/add', todo], {
  idempotencyKey: `todo:${todo.id}`,
  expectedRevision: runtime.getStateRevisions().committedRevision,
  observe: [['todos/count']],
  executionContext: { profile: 'interactive' },
});
```

Each immutable receipt records the root event and its synchronous dispatch
cascade, parentage, planned and committed Immer patches, state revisions,
the fully settled publication wave (including every recalculated subscription),
effect outcomes, observations, structured failures, timing, and retention
metadata. Matching idempotency retries replay the same retained operation;
conflicting input produces a rejected receipt.

Operations are attached to one explicit runtime, have memory-only retention
(up to 256 terminal entries), and never share a global registry. The package
uses the runtime's public lifecycle API; applications that do not install it
retain Reflex's normal queue and effect behavior.

For developer tools, `createOperationInspector(runtime)` decorates the core
inspector with `startEvent`, `executeEvent`, and `getOperation`.
