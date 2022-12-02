import express from 'express'
import Url from "url";
import {OrganizeGatewayStrategy} from "../src/api-client.js";
import {fromJson, getBody, toJson} from "../src/helpers.js";
import StyraRun, {DefaultSessionInputStrategy, Paginators} from "../src/run-sdk.js"

const JSON_CONTENT_TYPE = {'Content-Type': 'application/json'}

const port = 3000
const host = 'localhost'
const token = 'foobar'
const app = express()

const styraRun = StyraRun('http://localhost:4000', token, {
  connectionOptions: {
    organizeGatewaysStrategy: OrganizeGatewayStrategy.None
  },
  eventListeners: [(type, info) => { console.log(type, info) }]
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

app.all('/rbac/*', styraRun.rbacProxy({
  paginateUsers: Paginators.makeIndexedPaginator(3,
    (offset, limit, _) => users.slice(offset, offset + limit),
    (_) => users.length)
}))

app.all('/rbac2/*', styraRun.rbacProxy())

app.listen(port, host, () => {
  console.info(`Server started on port: ${port}`)
})

function dropDataPrefix(str) {
  return str.replace(/^\/?data/, '')
}
