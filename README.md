Node-to-node graph connections for [amqp-swarm][amqp-swarm].

# Usage

```javascript
// earlier in the script
const amqpSwarmGraph = require('amqp-swarm-graph')

// called every time amqp-swarm connects to a node
const onNodeFound = async (node) => {
  const graphNode = amqpSwarmGraph(node)

  // attaching handlers
  graphNode.on('connect', (ctx, data) => data === 'alohomora')
  graphNode.on('disconnect', (ctx, data) => data === 'severus please')

  // attaching event listeners
  graphNode.events.on('connect',
    (remoteId) => console.log(`${remoteId} connected`)
  )

  // connecting to another node
  const connected = await graphNode.connect('remote-id', {some: 'data'})
  if (connected) console.log('connection successful')

  // accessing state
  graphNode.states['remote-id'].wololo = true

  // disconnecting
  const disconnected = await graphNode.disconnect('remote-id', 'goodbye')
  if (!disconnected) {
    console.log('oh come on')
    graphNode.forceDisconnect('remote-id')
  }
}
```

amqp-swarm-graph operates over amqp-swarm nodes, allowing them to connect in a graph pattern with each other. It automatically pings connected nodes, enables connect and disconnect filters, and tracks a state value associated with the connection.

## Connections

Connection filters can be used to allow or deny connections based on data passed to them. The use case for this is business logic rather than authentication since all nodes run on server anyway, but if you feel like authentication is more relevant on the receiving side you can put it here too.

All connection filters take the following form:

```javascript
async (ctx, ...args) => accepted
```

The result is a boolean, if true, allows the operation to proceed. They can be placed on the `connect` and `disconnect` events like amqp-swarm handlers:

```javascript
graphNode.on(event, handler)
```

`ctx` has the `result` and `throw` properties, mirroring amqp-swarm. It also has the `state` property with a reference to the connection state, enabling filters to manipulate it immediately.

By default, if no connection filters are attached, all operations go through.

Connection operations can be initiated using the following methods:

 - `async graphNode.connect(remoteId, ...args)`: connects to a remote node, triggering its `connect` filters and passing `...args`
 - `async graphNode.disconnect(remoteId, ...args)`: disconnects from a remote node, triggering its `disconnect` filters and passing `...args`
 - `graphNode.forceDisconnect(remoteId)`: immediately disconnects remoteId

`graphNode.events` is an EventEmitter that receives the `connect` and `disconnect` events after a node has been connected or disconnected (including forceful disconnections). A string is passed to the event listeners, containing the involved remote's id.

## Connection state

`graphNode` has two getters, `connections` and `states`. `connections` is simply a list of the connected remote node IDs, while `states` is an object, where keys are remote IDs and the values are the actual state objects.

The purpose of the state is to store any value relevant to the connection. It is initialized to an empty object and it's deleted if the remote is disconnected.

# Contributing

Pull requests are welcome. As always, be respectful towards each other and maybe run or create tests, as appropriate. It's on `npm test`, as usual.

amqp-swarm-graph is available under the MIT license.

[amqp-swarm]: https://github.com/b3nsn0w/amqp-swarm