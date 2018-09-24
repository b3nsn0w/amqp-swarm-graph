// external modules
const debug = require('debug')('amqp-swarm-graph:index')
const { EventEmitter } = require('events')
const unwrap = require('async-unwrap')

// internal modules
const createEmitter = require('./emitter')

const REQUEST_NAME = 'lib/amqp-swarm-graph'

function createGraphNode (node) {
  const connectedPeers = new Map() // stores a state object for each connection
  const emitter = createEmitter({
    throw: node.throw
  })
  const events = new EventEmitter()

  const send = (remote, request, ...args) => node.send(remote, REQUEST_NAME, request, ...args)
  const connected = remote => connectedPeers.has(remote)

  node.on(REQUEST_NAME, (ctx, request, ...args) => {
    const remote = ctx.sender

    if (request === 'ping') {
      debug(`${node.id} got pinged by ${remote}`)
      // only answer ping if actually connected to remote node
      if (connected(remote)) return true
      else ctx.throw('Node is not connected', { errorName: 'not-connected' })
    }

    if (request === 'connect') return receiveConnect(remote, args[0])

    if (request === 'disconnect' && connected(remote)) return receiveDisconnect(remote, args[0]) // graceful disconnect
    if (request === 'force-disconnect' && connected(remote)) actuallyDisconnect(remote) // less graceful version
  })

  // connect request
  const sendConnect = async (remote, data) => {
    debug(`${node.id} sending connection request to ${remote}`)
    const [err, approved] = await send(remote, 'connect', data)[unwrap]
    if (err) return false // TODO should we just let this pass through instead?

    debug(`${node.id}'s connection request to ${remote} was ${approved ? 'approved' : 'denied'}`)
    if (approved) actuallyConnect(remote)
    return approved
  }

  const receiveConnect = async (remote, data) => {
    debug(`${node.id} received connection request from ${remote}`)
    if (connected(remote)) return true

    const initialState = {}

    const resultingContext = await emitter.emit('connect', data, {
      result: true,
      state: initialState
    })
    const approved = resultingContext.result

    debug(`${node.id} ${approved ? 'approved' : 'denied'} ${remote}'s connection request`)
    if (approved) actuallyConnect(remote, initialState)
    return approved
  }

  // disconnect request
  const sendDisconnect = async (remote, data) => {
    debug(`${node.id} sending disconnect request to ${remote}`)
    const [err, approved] = await send(remote, 'disconnect', data)[unwrap]
    if (err) return forceDisconnect(remote) // support for angry disconnect: check

    debug(`${node.id}'s disconnect request to ${remote} was ${approved ? 'approved' : 'denied'}`)
    if (approved) actuallyDisconnect(remote)
    return approved
  }

  const receiveDisconnect = async (remote, data) => {
    debug(`${node.id} received disconnect request from ${remote}`)
    if (!connected(remote)) return true

    const resultingContext = await emitter.emit('disconnect', data, {
      result: true,
      state: connectedPeers.get(remote)
    })
    const approved = resultingContext.result

    debug(`${node.id} ${approved ? 'approved' : 'denied'} ${remote}'s disconnect request`)
    if (approved) actuallyDisconnect(remote)
    return approved
  }

  // slightly more firm disconnect request
  const forceDisconnect = (remote) => {
    if (!connected(remote)) return false // extra safeguard because we're sending stuff

    send(remote, 'force-disconnect').catch(() => {}) // no need for await, it's like a udp joke, we don't care if you get it

    debug(`${node.id} forcefully disconnected ${remote}`)
    actuallyDisconnect(remote)
    return true
  }

  // actual connection control
  const actuallyConnect = (remote, state = {}) => {
    if (connected(remote)) return true // no need to connect twice

    // initialize state
    connectedPeers.set(remote, state)
    startPinging(remote)

    events.emit('connect', remote)
  }

  const actuallyDisconnect = (remote) => {
    if (!connected(remote)) return false // don't disconnect twice
    connectedPeers.delete(remote)

    events.emit('disconnect', remote)
  }

  const startPinging = (remote) => {
    const interval = setInterval(async () => {
      const [err] = await send(remote, 'ping')[unwrap]

      if (err) {
        debug(`${node.id} failed to reach ${remote}`)
        clearInterval(interval)
        forceDisconnect(remote)
      }
    }, 1000)
  }

  // create interface
  return {
    async connect (remote, data) {
      return sendConnect(remote, data)
    },
    async disconnect (remote, data) {
      return sendDisconnect(remote, data)
    },
    forceDisconnect (remote) {
      return forceDisconnect(remote)
    },
    get states () {
      return [...connectedPeers.entries()].reduce((acc, [key, value]) => {
        acc[key] = value
        return acc
      }, {})
    },
    get connections () {
      return [...connectedPeers.keys()]
    },
    on: emitter.addHandler,
    events,
    state: {} // for custom stuff
  }
}

module.exports = createGraphNode
