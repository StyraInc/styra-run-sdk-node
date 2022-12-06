import express from 'express'
import Url from "url";
import {OrganizeGatewayStrategy} from "../src/api-client.js";
import {fromJson, getBody, toJson} from "../src/helpers.js";
import {
  proxyRbac,
  proxyRbacDeleteUserBinding,
  proxyRbacGetRoles,
  proxyRbacGetUserBinding,
  proxyRbacGetUserBindings,
  proxyRbacListUserBindings,
  proxyRbacPutUserBinding
} from "../src/rbac-proxy.js";
import StyraRun, {DefaultSessionInputStrategy, Paginators} from "../src/run-sdk.js"

const JSON_CONTENT_TYPE = {'Content-Type': 'application/json'}

const serverPort = 3000
const serverHost = '127.0.0.1'
const apiPort = 4000
const apiHost = '127.0.0.1'
const token = 'foobar'
const app = express()

function setup(app, enableLogging = false) {
  const eventListeners = enableLogging ? [(type, info) => {console.log(type, info)}] : []
  const styraRun = StyraRun(`http://${apiHost}:${apiPort}`, token, {
    connectionOptions: {
      organizeGatewaysStrategy: OrganizeGatewayStrategy.None
    },
    eventListeners
  })

//
// Queries
//

  app.post('/batch_query', styraRun.proxy())

  app.post('/query/*', async (request, response) => {
    const url = Url.parse(request.url)
    const path = url.path.replace(/^\/?query/, '')
    const body = await getBody(request)
    const input = fromJson(body)

    try {
      const result = await styraRun.query(path, input)
      response.writeHead(200, JSON_CONTENT_TYPE)
      response.end(toJson(result))
    } catch (e) {
      response.writeHead(500, JSON_CONTENT_TYPE)
      response.end({err: e.message})
    }
  })

  app.post('/check/*', async (request, response) => {
    const url = Url.parse(request.url)
    const path = url.path.replace(/^\/?query/, '')
    const body = await getBody(request)
    const input = fromJson(body)

    try {
      const result = await styraRun.check(path, input)
      response.writeHead(200, JSON_CONTENT_TYPE)
      response.end(toJson(result))
    } catch (e) {
      response.writeHead(500, JSON_CONTENT_TYPE)
      response.end({err: e.message})
    }
  })

//
// Data
//

  app.get('/data/*', async (request, response) => {
    const url = Url.parse(request.url)
    const path = dropDataPrefix(url.path)

    try {
      const result = await styraRun.getData(path)
      response.writeHead(200, JSON_CONTENT_TYPE)
      response.end(toJson(result))
    } catch (e) {
      response.writeHead(500, JSON_CONTENT_TYPE)
      response.end({err: e.message})
    }
  })

  app.put('/data/*', async (request, response) => {
    const url = Url.parse(request.url)
    const path = dropDataPrefix(url.path)
    const body = await getBody(request)
    const data = fromJson(body)

    try {
      const result = await styraRun.putData(path, data)
      response.writeHead(200, JSON_CONTENT_TYPE)
      response.end(toJson(result))
    } catch (e) {
      response.writeHead(500, JSON_CONTENT_TYPE)
      response.end({err: e.message})
    }
  })

  app.delete('/data/*', async (request, response) => {
    const url = Url.parse(request.url)
    const path = dropDataPrefix(url.path)

    try {
      const result = await styraRun.deleteData(path)
      response.writeHead(200, JSON_CONTENT_TYPE)
      response.end(toJson(result))
    } catch (e) {
      response.writeHead(500, JSON_CONTENT_TYPE)
      response.end({err: e.message})
    }
  })

//
// RBAC
//

  const users = ['alice', 'bob', 'bryan', 'emily', 'harold', 'vivian']
  const userProducer = async (offset, limit, _, __) => users.slice(offset, offset + limit)
  const userCounter = async (_, __) => users.length
  const paginator = Paginators.makeIndexedPaginator(3, userProducer, userCounter)


// app.all('/rbac/*', proxyRbac(styraRun.rbacManager()))

  app.get('/roles', proxyRbacGetRoles(styraRun.rbacManager()))
  app.get('/user_bindings/*', proxyRbacGetUserBinding(styraRun.rbacManager()))
  app.delete('/user_bindings/*', proxyRbacDeleteUserBinding(styraRun.rbacManager()))
  app.put('/user_bindings/*', proxyRbacPutUserBinding(styraRun.rbacManager()))
  app.get('/user_bindings_all', proxyRbacListUserBindings(styraRun.rbacManager()))
  app.get('/user_bindings', proxyRbacGetUserBindings(styraRun.rbacManager(), paginator))
}

let server = null
let loggingEnabled = false
export function startServer(enableLogging = false) {
  loggingEnabled = enableLogging
  setup(app, enableLogging)

  if (enableLogging) {
    console.info('Starting server')
  }
  return new Promise((resolve, reject) => {
    try {
      server = app.listen(serverPort, serverHost, () => {
        if (enableLogging) {
          console.info(`Server started on port: ${serverPort}`)
        }
        resolve()
      })
    } catch (err) {
      if (enableLogging) {
        console.info(`Server failed to start on port: ${serverPort}`, err)
      }
      reject(err)
    }
  })
}

export function stopServer() {
  if (loggingEnabled) {
    console.info('Stopping server')
  }
  return new Promise((resolve, reject) => {
    try {
      if (server) {
        server.close(() => {
          if (loggingEnabled) {
            console.info(`Server stopped`)
          }
          server = null
          resolve()
        })
      } else {
        reject(new Error("No server started"))
      }
    } catch (err) {
      reject(err)
    }
  })
}

function dropDataPrefix(str) {
  return str.replace(/^\/?data/, '')
}
