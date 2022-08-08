import Path from "path"
import {ApiClient} from "./api-client.js"
import {StyraRunError, StyraRunAssertionError, StyraRunHttpError} from "./errors.js"
import {getBody, toJson, fromJson} from "./helpers.js"
import {Manager as RbacManager} from "./rbac-management.js"

// TODO: Add support for versioning/ETags for data API requests
// TODO: Add support for fail-over/retry when server connection is broken

/**
 * @module StyraRun
 */

/**
 * A client for communicating with the Styra Run API.
 * @class
 */
export class Client {
  constructor({
                url = "https://api-test.styra.com",
                token,
                batchMaxItems = 20,
                inputTransformers = {},
                sortGateways = DEFAULT_SORT_GATEWAYS_CALLBACK,
                eventListeners = []
              }) {
    this.batchMaxItems = batchMaxItems
    this.inputTransformers = inputTransformers
    this.apiClient = new ApiClient(url, token, {sortGateways})
    this.eventListeners = eventListeners
  }

  async handleEvent(type, info) {
    this.eventListeners.forEach((listener) => listener(type, info))
  }

  setInputTransformer(path, transformer) {
    this.inputTransformers[path] = transformer
  }

  /**
   * @typedef {{result: *}|{}} CheckResult
   */
  /**
   * Makes an authorization check against a policy rule specified by `path`.
   * Where `path` is the trailing component(s) of the full request path `"/v1/projects/<USER_ID>/<PROJECT_ID>/envs/<ENVIRONMENT_ID>/data/<PATH>"`
   *
   * Returns a `Promise` that on a successful Styra Run API response resolves to the response body dictionary, e.g.: `{"result": ...}`.
   * On error, the returned `Promise` is rejected with a {@link StyraRunError}.
   *
   * {@link LoadResultPromise}
   *
   * @param path the path to the policy rule to query
   * @param input the input document for the query
   * @returns {Promise<CheckResult,StyraRunError>}
   */
  async check(path, input = undefined) {
    const query = input ? {input} : {}

    try {
      const json = toJson(query)
      const decission = await this.apiClient.post(Path.join('data', path), json)
      return fromJson(decission)
    } catch (err) {
      throw new StyraRunError('Check failed', path, query, err)
    }
  }

  /**
   * @typedef {{code: string, message: string}} CheckError
   */
  /**
   * @typedef {{check: CheckResult}|{error: CheckError}} BatchCheckItemResult
   */
  /**
   * @typedef {BatchCheckItemResult[]} BatchCheckResult
   */
  /**
   * Makes a batched authorization check.
   * The provided `items` is a list of dictionaries with the properties:
   *
   * * `path`: the path to the policy rule to query for this entry
   * * `input`: (optional) the input document for this entry
   *
   * If, `input` is provided, it will be applied across all query items.
   *
   * Returns a `Promise` that is resolved to a list of result dictionaries, where each entry corresponds to an entry
   * with the same index in `items`.
   * On error, the returned `Promise` is rejected with a {@link StyraRunError}.
   *
   * @param items the list of queries to batch
   * @param input the input document to apply to the entire batch request, or `undefined`
   * @returns {Promise<BatchCheckResult, StyraRunError>} a list of result dictionaries
   */
  async batchCheck(items, input = undefined) {
    // Split the items over multiple batch requests, if necessary;
    // to cope with server-side enforced size limit of batch request.
    const remainingItems = [...items]
    const chunkedItems = []
    while (remainingItems.length > 0) {
      chunkedItems.push(remainingItems.splice(0, this.batchMaxItems))
    }

    const queries = chunkedItems.map(async (items) => {
      const query = {items}
      if (input) {
        query.input = input
      }

      try {
        const json = toJson(query)
        const response = await this.apiClient.post(Path.join('data_batch'), json)
        return fromJson(response)
      } catch (err) {
        throw new StyraRunError('Batched check failed', undefined, query, err)
      }
    })

    const decisionChunks = await Promise.all(queries)
    const decisions = decisionChunks
      .map((decision) => decision.result ?? [])
      .flat(1)
    return decisions
  }

  /**
   * @callback AssertPredicate
   * @param {CheckResult} decision
   * @returns {Boolean} `true` is `decision` is valid, `false` otherwise
   */
  /**
   * Makes an authorization check against a policy rule specified by `path`.
   * Where `path` is the trailing component(s) of the full request path
   * `"/v1/projects/<USER_ID>/<PROJECT_ID>/envs/<ENVIRONMENT_ID>/data/<PATH>"`
   *
   * The provided `predicate` is a callback that takes the Styra Run check response
   * body as argument, and should return `true` if it sattisfies the authorization requirements, and `false` otherwise.
   *
   * ```js
   * const input = ...
   * client.assert('example/allowed', input, (res) => {
   *   res?.result === true
   * })
   *   .then(() => { ... })
   *   .catch((err) => { ... })
   * ```
   *
   * Returns a `Promise` that resolves with no value, and rejected with a {@link StyraRunError}.
   * If the policy decision is rejected by the provided `predicate`, the returned `Promise` is rejected with a {@link StyraRunAssertionError}.
   * On error, the returned `Promise` is rejected with a {@link StyraRunError}.
   *
   * @param path the path to the policy rule to query
   * @param input the input document for the query
   * @param predicate a callback function, taking a response body dictionary as arg, returning true/false
   * @returns {Promise<undefined, StyraRunError|StyraRunAssertionError>}
   */
  async assert(path, input = undefined, predicate = DEFAULT_PREDICATE) {
    let result
    try {
      const decission = await this.check(path, input)
      result = predicate(decission)
    } catch (err) {
      throw new StyraRunError('Allow check failed', path, {input}, err)
    }

    if (!result) {
      throw new StyraRunAssertionError(path, {input})
    }
  }

  /**
   * Convenience function that operates like {@link assert}, but returns a `Promise`,
   * that on a successful response resolves with `data` as its output.
   *
   * ```js
   * const myData = ...
   * client.assertAndReturn(myData, 'example/allowed')
   *   .then((allowedData) => { ... })
   *   .catch((err) => { ... })
   * ```
   *
   * @param data optional value to return on asserted
   * @param path the path to the policy rule to query
   * @param input the input document for the query
   * @param predicate a callback function, taking a response body dictionary as arg, returning true/false
   * @returns {Promise<?, StyraRunError>}
   * @see {@link assert}
   */
  async assertAndReturn(data, path, input = undefined, predicate = DEFAULT_PREDICATE) {
    await this.assert(path, input, predicate)
    return data
  }

  /**
   * For each entry in the provided `list`, an authorization check against a policy rule wit a boolean return type, specified by `path` is made.
   * Where `path` is the trailing component(s) of the full request path `"/v1/projects/${UID}/${PID}/envs/${EID}/data/${path}"`
   *
   * Returns a `Promise` that resolves to a filtered version of the provided `list`.
   * On error, the returned `Promise` is rejected with a {@link StyraRunError}.
   *
   * @param path the path to the policy rule to query
   * @param list the list to filter
   * @param toInput optional, a callback that, given a list entry and an index, should return an `input` document
   * @param toPath optional, a callback that, given a list entry and an index, should return a `path` string. If provided, overrides the global `'path'` argument
   * @returns {Promise<*[], StyraRunError>}
   */
  async filter(list, predicate, path = undefined, toInput = undefined, toPath = undefined) {
    if (list.length === 0) {
      return Promise.resolve([])
    }

    const transformer = (entry, i) => {
      const item = {}

      const itemInput = toInput ? toInput(entry, i) : undefined
      if (itemInput) {
        item.input = itemInput
      }

      const itemPath = toPath ? toPath(entry, i) : undefined
      item.path = itemPath ?? path
      if (item.path === undefined) {
        throw new StyraRunError(`No 'path' provided for list entry at ${i}`)
      }

      return item
    }

    let resultList
    try {
      const items = list.map(transformer)
      resultList = await this.batchCheck(items)
    } catch (err) {
      throw new StyraRunError('Allow filtering failed', path, undefined, err)
    }

    if (resultList === undefined || resultList.length !== list.length) {
      throw new StyraRunError(`Returned result list size (${resultList?.length}) not equal to provided list size (${list.length})`,
        path)
    }

    try {
      return list.filter((_, i) => predicate(resultList[i]?.check))
    } catch (err) {
      throw new StyraRunError('Allow filtering failed', path, undefined, err)
    }
  }

  /**
   * @typedef {{result: unknown}} DataResult
   */
  /**
   * Fetch data from the `Styra Run` data API.
   * Where `path` is the trailing component(s) of the full request path `"/v1/projects/${UID}/${PID}/envs/${EID}/data/${path}"`
   *
   * Returns a `Promise` that on a successful response resolves to the {@link DataResult response body dictionary}: `{"result": ...}`.
   * On error, the returned `Promise` is rejected with a {@link StyraRunError}.
   *
   * @param path the path identifying the data to fetch
   * @param def the default value to return on a `404 Not Found` response
   * @returns {Promise<DataResult, StyraRunError>}
   */
  async getData(path, def = undefined) {
    try {
      const response = await this.apiClient.get(Path.join('data', path))
      return fromJson(response)
    } catch (err) {
      if (err instanceof StyraRunHttpError && err.isNotFoundStatus()) {
        return {result: def}
      }
      return Promise.reject(new StyraRunError('GET data request failed', path, undefined, err))
    }
  }

  /**
   * A Styra Run API response containing the `version` of the updated data.
   *
   * @typedef {{version: number}} DataUpdateResult
   */
  /**
   * Upload data to the `Styra Run` data API.
   * Where `path` is the trailing component(s) of the full request path `"/v1/projects/${UID}/${PID}/envs/${EID}/data/${path}"`.
   *
   * Returns a `Promise` that on a successful response resolves to the Styra Run API {@link DataUpdateResult response body dictionary}: `{"version": ...}`.
   * On error, the returned `Promise` is rejected with a {@link StyraRunError}.
   *
   * @param path the path identifying the data to upload
   * @param data the data to upload
   * @returns {Promise<DataUpdateResult, StyraRunError>}
   */
  async putData(path, data) {
    try {
      const json = toJson(data)
      const response = await this.apiClient.put(Path.join('data', path), json)
      return fromJson(response)
    } catch (err) {
      return await Promise.reject(new StyraRunError('PUT data request failed', path, undefined, err))
    }
  }

  /**
   * Remove data from the `Styra Run` data API.
   * Where `path` is the trailing component(s) of the full request path `"/v1/projects/${UID}/${PID}/envs/${EID}/data/${path}"`
   *
   * Returns a `Promise` that on a successful response resolves to the Styra Run API {@link DataUpdateResult response body dictionary}: `{"version": ...}`.
   * On error, the returned `Promise` is rejected with a {@link StyraRunError}.
   *
   * @param path the path identifying the data to remove
   * @returns {Promise<DataUpdateResult, StyraRunError>}
   */
  async deleteData(path) {
    try {
      const response = await this.apiClient.delete(Path.join('data', path))
      return fromJson(response)
    } catch (err) {
      return await Promise.reject(new StyraRunError('DELETE data request failed', path, undefined, err))
    }
  }

  /**
   * @callback OnProxyCallback
   * @param request the incoming HTTP request
   * @param response the outgoing HTTP response
   * @param {string} path the path to the policy rule being queried
   * @param {*} input the input document/value for the policy query
   * @returns the input document/value that should be used for the proxied policy query
   */
  /**
   * @callback OnProxyDoneCallback
   * @param request the incoming HTTP request
   * @param response the outgoing HTTP response
   * @param {BatchCheckItemResult[]} result the result of the proxied policy query, that should be serialized and returned to the caller
   */
  /**
   * @callback OnProxyErrorCallback
   * @param request the incoming HTTP request
   * @param response the outgoing HTTP response
   * @param {StyraRunError} error the error generated when proxying the policy query
   */
  /**
   * Returns an HTTP proxy function
   *
   * @param {OnProxyCallback} onProxy callback called for every proxied policy query
   * @param {OnProxyDoneCallback} onDone
   * @param {OnProxyErrorCallback} onError
   * @returns {(Function(*, *): Promise)}
   */
  proxy(onProxy = DEFAULT_ON_PROXY_HANDLER, onDone = DEFAULT_PROXY_DONE_HANDLER, onError = DEFAULT_PROXY_ERROR_HANDLER) {
    return async (request, response) => {
      try {
        if (request.method !== 'POST') {
          response.writeHead(405, {'Content-Type': 'text/html'})
          response.end('Method Not Allowed!')
          return
        }

        const body = await getBody(request)
        const json = fromJson(body)

        if (!Array.isArray(json)) {
          response.writeHead(400, {'Content-Type': 'text/html'})
          response.end('invalid proxy request')
          return
        }

        const batchItemPromises = json.map((query, i) => {
          return new Promise(async (resolve, reject) => {
            const path = query.path
            if (path === undefined) {
              reject(new StyraRunError(`proxied query with index ${i} has missing 'path'`))
            }

            try {
              let input = await onProxy(request, response, path, query.input)
              const inputTransformer = this.inputTransformers[path]
              if (inputTransformer) {
                input = await inputTransformer(path, input)
              }
              resolve({path, input})
            } catch (err) {
              reject(new StyraRunError('Error transforming input', path, {input: query.input}, err))
            }
          })
        })

        const batchItems = await Promise.all(batchItemPromises)
        const batchResult = await this.batchCheck(batchItems)
        const result = (batchResult ?? []).map((item) => item.check ?? {})

        onDone(request, response, result)
      } catch (err) {
        onError(request, response, err)
      }
    }
  }

  /**
   * Callback function that must create a dictionary representing an `input` document used for 
   * policy queries related to RBAC management access.
   * 
   * The returned `indput` document should return two attributes:
   * 
   * * `subject`: a `string` representing the subject of the user session with which the request was made.
   * * `tenant`: a `string` representing the tenant of the user session with which the request was made.
   * 
   * @callback OnRbacCreateInputCallback
   * @param request the incoming HTTP request
   * @param {StyraRunError} error the error generated when proxying the policy query
   * @returns {Object<string, *>} an `input` document
   */
  /**
   * Callback function that must return a list of `string` user IDs.
   * 
   * @callback OnRbacGetUsersCallback
   * @param {number} offset an integer index of where in the range of users to start enumerating
   * @param {number} limit an integer count of the number of users, starting at `offset` to enumerate
   * @returns {string[]} a list of user IDs
   */
  /**
   * A callback function that is called when a binding is about to be upserted.
   * Must return a boolean, where `true` indicates the binding may be created, and `false`
   * that it must not.
   * 
   * When called, implementations may create new users if necessary.
   * 
   * @callback OnRbacOnSetBindingCallback
   * @param {string} id the id of the binding's user
   * @param {string[]} roles the roles to apply to the binding's user
   * @returns {boolean} `true` if the binding should be applied, `false` otherwise
   */
  /**
   * Returns an HTTP API function.
   *
   * @param {OnRbacCreateInputCallback} createInput 
   * @param {OnRbacGetUsersCallback} getUsers
   * @param {OnRbacOnSetBindingCallback} onSetBinding
   * @param {number} pageSize `integer` representing the size of each page of enumerated user bindings
   * @returns {(Function(*, *): Promise)}
   */
  manageRbac(createInput = DEFAULT_RBAC_INPUT_CALLBACK, getUsers = DEFAULT_RBAC_USERS_CALLBACK, onSetBinding = DEFAULT_RBAC_ON_SET_BINDING_CALLBACK, pageSize = 0) {
    const manager = new RbacManager(this, createInput, getUsers, onSetBinding, pageSize)
    return (request, response) => {
      manager.handle(request, response)
    }
  }
}

function DEFAULT_SORT_GATEWAYS_CALLBACK(gateways) {
  return gateways
}

export function DEFAULT_PREDICATE(decision) {
  return decision?.result === true
}

function DEFAULT_RBAC_USERS_CALLBACK(offset, limit) {
  return []
} 

function DEFAULT_RBAC_ON_SET_BINDING_CALLBACK(id, roles) {
  return true
} 

function DEFAULT_RBAC_INPUT_CALLBACK(request) {
  return {}
} 

function DEFAULT_ON_PROXY_HANDLER(request, response, path, input) {
  return input
}

function DEFAULT_PROXY_DONE_HANDLER(request, response, result) {
  response.writeHead(200, {'Content-Type': 'application/json'})
    .end(toJson(result))
}

function DEFAULT_PROXY_ERROR_HANDLER(request, response, error) {
  response.writeHead(500, {'Content-Type': 'text/html'})
  response.end('policy check failed')
}

/**
 * Construct a new `Styra Run` Client from the passed `options` dictionary.
 * Valid options are:
 * * `url`: (string) The `Styra Run` API URL
 * * `token`: (string) the API key (Bearer token) to use for calls to the `Styra Run` API
 * * `batchMaxItems`: (number) the maximum number of query items to send in a batch request. If the number of items exceed this number, they will be split over multiple batch requests. (default: 20)
 *
 * @param options
 * @returns {Client}
 * @constructor
 */
function New(options) {
  return new Client(options);
}

export default {
  New
}