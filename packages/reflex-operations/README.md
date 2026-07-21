# @flexsurfer/reflex-operations

Optional operation receipts for an explicit `@flexsurfer/reflex` runtime.

```ts
import { createOperationClient } from '@flexsurfer/reflex-operations';

const operations = createOperationClient(runtime);
const { operation } = await operations.dispatchAndWait(['todos/add', todo], {
  idempotencyKey: `todo:${todo.id}`,
  observe: [['todos/count']],
});
```

The package deliberately depends only on the public runtime API. It records a
runtime-local receipt, waits for `runtime.flush()`, and optionally reads public
subscriptions after publication. It does not alter Reflex's kernel or install
global state.
