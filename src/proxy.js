import {StyraRunError} from "./errors.js";
import {fromJson, getBody, toJson} from "./helpers.js";
import {Method} from "./types.js";

const { POST } = Method

const EventType = {
  PROXY: 'proxy'
}

export default class Proxy {
  /**
   * @param {StyraRunClient} styraRunClient
   * @param {SessionInputStrategyCallback} onProxy
   */
  constructor(styraRunClient, onProxy) {
    this.styraRunClient = styraRunClient
    this.onProxy = onProxy
  }

  /**
   * @param {IncomingMessage} request
   * @param {ServerResponse} response
   * @returns {Promise<void>}
   */
  async handle(request, response) {
    try {
      if (request.method !== POST) {
        response.writeHead(405, {'Content-Type': 'text/html'})
        response.end('Method Not Allowed!')
        return
      }

      const body = await getBody(request)
      const batchQuery = fromJson(body)

      if (!Array.isArray(batchQuery.items)) {
        response.writeHead(400, {'Content-Type': 'text/html'})
        response.end('invalid proxy request')
        return
      }

      const batchItemPromises = batchQuery.items.map((query, i) => {
        return new Promise(async (resolve, reject) => {
          const path = query.path
          if (!path) {
            reject(new StyraRunError(`proxied query with index ${i} has missing 'path'`))
          }

          try {
            const input = await this.onProxy(request, path, query.input)
            resolve({path, input})
          } catch (err) {
            reject(new StyraRunError('Error transforming input', path, err))
          }
        })
      })

      const batchItems = await Promise.all(batchItemPromises)
      const batchResult = await this.styraRunClient.batchQuery(batchItems, batchQuery.input)
      this.styraRunClient.signalEvent(EventType.PROXY, {query: batchQuery, result: batchResult})

      // Only forwarding result to frontend; dropping e.g. errors
      const result = (batchResult || [])
        .map((item) => item.result ? {result: item.result} : {})

      response.writeHead(200, {'Content-Type': 'application/json'})
      response.end(toJson({result}))
    } catch (err) {
      this.styraRunClient.signalEvent(EventType.PROXY, {err})
      response.writeHead(500, {'Content-Type': 'text/html'})
      response.end('policy check failed')
    }
  }
}
