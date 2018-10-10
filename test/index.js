/* eslint-env mocha */
/* eslint-disable no-unused-expressions */

const amqpSwarm = require('amqp-swarm')
const { expect } = require('chai')
const sinon = require('sinon')
// const unwrap = require('async-unwrap')
const WebSocket = require('ws')

const amqpSwarmGraph = require('..')

const server = amqpSwarm.server() // this needs an amqp 0-9-1 server on localhost and the default port (5672)
const wss = new WebSocket.Server({ port: 29652 })

const getNode = name => new Promise((resolve, reject) => {
  wss.on('connection', function listener (ws, request) {
    if (request.url.slice(1) === name) {
      resolve(server.createNode(name, ws))
      wss.removeListener('connection', listener)
    }
  })
})
const createNode = async name => {
  const nodePromise = getNode(name)
  const client = amqpSwarm.client(`ws://localhost:29652/${name}`)
  const node = await nodePromise

  return {
    client,
    node,
    graphNode: amqpSwarmGraph(node)
  }
}

const foo = createNode('foo')
const bar = createNode('bar')

let nodes = {}
let listeners = {}

describe('amqp-swarm-graph', () => {
  before(async () => {
    nodes.foo = await foo
    nodes.bar = await bar

    listeners.foo = {
      connect: sinon.spy(),
      disconnect: sinon.spy(),
      connectApproval: sinon.spy(() => false),
      disconnectApproval: sinon.spy(() => true)
    }
    nodes.foo.graphNode.events.on('connect', listeners.foo.connect)
    nodes.foo.graphNode.events.on('disconnect', listeners.foo.disconnect)
    nodes.foo.graphNode.on('connect', listeners.foo.connectApproval)
    nodes.foo.graphNode.on('disconnect', listeners.foo.disconnectApproval)

    listeners.bar = {
      connect: sinon.spy(),
      disconnect: sinon.spy(),
      connectApproval: sinon.spy((ctx) => {
        ctx.state.modifiedOnApproval = true
        return true
      }),
      disconnectApproval: sinon.spy(() => false) // bar doesn't want you to disconnect
    }
    nodes.bar.graphNode.events.on('connect', listeners.bar.connect)
    nodes.bar.graphNode.events.on('disconnect', listeners.bar.disconnect)
    nodes.bar.graphNode.on('connect', listeners.bar.connectApproval)
    nodes.bar.graphNode.on('disconnect', listeners.bar.disconnectApproval)
  })

  it('can connect successfully', async () => {
    const connected = await nodes.foo.graphNode.connect('bar', 'actual drill') // this is passed for a later test

    expect(connected).to.be.true
    expect(nodes.foo.graphNode.connections).to.include('bar')
    expect((await bar).graphNode.connections).to.include('foo')

    nodes.foo.graphNode.states.bar.accessed = true
  })

  it('calls event listeners on connect', async () => {
    expect(listeners.foo.connect.calledOnceWith('bar')).to.be.true
    expect(listeners.bar.connect.calledOnceWith('foo')).to.be.true
  })

  it('calls approval filters on connect', async () => {
    expect(listeners.bar.connectApproval.calledOnce).to.be.true

    const [context, data] = listeners.bar.connectApproval.lastCall.args

    expect(context.result).to.be.true
    expect(context.throw).to.be.a('function')
    expect(context.state).to.be.an('object')
    expect(context.remote).to.equal('foo')

    expect(data).to.equal('actual drill')
  })

  it('carries state over since the connection', async () => {
    expect(nodes.bar.graphNode.states.foo.modifiedOnApproval).to.be.true
    expect(nodes.foo.graphNode.states.bar.accessed).to.be.true
  })

  it('calls disconnect filters', async () => {
    const disconnected = await nodes.foo.graphNode.disconnect('bar', 'let it go')

    expect(disconnected).to.be.false
    expect(listeners.bar.disconnectApproval.calledOnce).to.be.true

    const [context, data] = listeners.bar.disconnectApproval.lastCall.args

    expect(context.state).to.equal(nodes.bar.graphNode.states.foo)
    expect(data).to.equal('let it go')
  })

  it("doesn't call event listeners on denied disconnect", async () => {
    expect(listeners.foo.disconnect.called).to.be.false
    expect(listeners.bar.disconnect.called).to.be.false
  })

  it('can disconnect successfully', async () => {
    const disconnected = await nodes.bar.graphNode.disconnect('foo') // bar's disconnect filter doesn't approve

    expect(disconnected).to.be.true
    expect(listeners.bar.disconnectApproval.calledOnce).to.be.true

    expect(nodes.foo.graphNode.connections).to.not.include('bar')
    expect(nodes.bar.graphNode.connections).to.not.include('foo')
  })

  it('calls event listeners on disconnect', async () => {
    expect(listeners.foo.disconnect.calledOnceWith('bar')).to.be.true
    expect(listeners.bar.disconnect.calledOnceWith('foo')).to.be.true
  })

  it('erases state after disconnect', async () => {
    expect(nodes.foo.graphNode.states.bar).to.not.exist
    expect(nodes.bar.graphNode.states.foo).to.not.exist
  })

  it('can deny connections', async () => {
    const connected = await nodes.bar.graphNode.connect('foo') // foo's connect filter doesn't approve

    expect(connected).to.be.false

    expect(nodes.foo.graphNode.connections).to.not.include('bar')
    expect(nodes.bar.graphNode.connections).to.not.include('foo')
  })

  it('can force disconnections without approval', async function () {
    this.timeout(3000)

    // we're currently disconnected, so let's make sure we connect
    const connected = await nodes.foo.graphNode.connect('bar')
    expect(connected).to.be.true

    // now it's time to kill that connection
    const disconnected = nodes.foo.graphNode.forceDisconnect('bar')

    expect(disconnected).to.be.true
    expect(nodes.foo.graphNode.connections).to.not.include('bar')

    // it's a bit tricky because forceDisconnect is synchronous and doesn't wait for the approval of the other node, so let's wait a bit
    await new Promise((resolve, reject) => setTimeout(resolve, 1000))

    expect(nodes.bar.graphNode.connections).to.not.include('foo')
  })

  it('disconnects when a remote shuts down', async function () {
    this.timeout(5000) // this is gonna be a long one too

    // disconnected again... too much disconnect cases? After all you can fail a million ways even if you only have one plan
    const connected = await nodes.foo.graphNode.connect('bar')
    expect(connected).to.be.true

    nodes.foo.client.close() // we're simulating a disconnected client here

    // lots of timeouts to trigger here
    await new Promise((resolve, reject) => setTimeout(resolve, 2500))

    expect(nodes.bar.graphNode.connections).to.not.include('foo')
  })

  after(async () => {
    // nodes.foo.client.close() // foo's client was closed in the last test
    nodes.bar.client.close()
    server.close()
    wss.close()
  })
})
