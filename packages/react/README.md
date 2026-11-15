# @pplnd/react

React bindings for [`@pplnd/core`](https://pplnd.dev/): hooks that bind `Op` managers, machine
actors, `EventBus` subscriptions, and fallible loads to the component lifecycle. Hooks bind — they
never create state; everything stateful is plain TypeScript defined outside React.

Peer dependencies: `react >= 19`, `@pplnd/core`. Zero runtime dependencies. Private until the first
release.
