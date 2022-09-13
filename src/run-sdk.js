import Path from "path"
import {ApiClient} from "./api-client.js"
import {StyraRunError, StyraRunAssertionError, StyraRunHttpError} from "./errors.js"
import {getBody, toJson, fromJson} from "./helpers.js"
import {RbacManager} from "./rbac-management.js"
import {BATCH_MAX_ITEMS} from "./constants.js"
import Proxy from "./proxy.js"
import {Paginators} from "./rbac-management.js"

// TODO: Add support for versioning/ETags for data API requests
// TODO: Add support for fail-over/retry when server connection is broken

/**
 * @module StyraRun
 */

const EventType = {
  ASSERT: 'assert',
  BATCH_QUERY: 'batch-query',
  CHECK: 'check',
  FILTER: 'filter',
  QUERY: 'query',
  GET_DATA: 'get-data',
  PUT_DATA: 'put-data',
  DELETE_DATA: 'delete-data'
}

/**
 * @callback SdkEventListener
 * @param {string} type the type of event signaled
 * @param {Object} info context-dependent info about the event
 */

/**
 * @typedef {Object} SdkOptions
 * @property {number} batchMaxItems the maximum number of query items to send in a batch request. If the number of items exceed this number, they will be split over multiple batch requests. (default: 20)
 * @property {ClientOptions} connectionOptions connectivity options
 * @property {SdkEventListener[]} eventListeners
 */
/**
 * A client for communicating with the Styra Run API.
 * @class
 */
export class StyraRunClient {
  constructor(url, token, {
    batchMaxItems = BATCH_MAX_ITEMS,
    connectionOptions,
    eventListeners = []
  }) {
    this.batchMaxItems = batchMaxItems
    this.apiClient = new ApiClient(url, token, {...connectionOptions, eventListeners})
    this.eventListeners = eventListeners // currently no README example on this usage?
  }

  signalEvent(type, info) {
    this.eventListeners.forEach((listener) => listener(type, info))
  }

  /**
   * @typedef {{result: *}|{}} QueryResult
   */

  /**
   * Makes an authorization query against a policy rule specified by `path`.
   * Where `path` is the trailing segment of the full request path
   * `"/v1/projects/<USER_ID>/<PROJECT_ID>/envs/<ENVIRONMENT_ID>/data/<PATH>"`
   *
   * Returns a `Promise` that on a successful Styra Run API response resolves to the response body dictionary, e.g.: `{"result": ...}`.
   * On error, the returned `Promise` is rejected with a {@link StyraRunError}.
   *
   * @param {string} path the path to the policy rule to query
   * @param {*|undefined} input the input document/value for the query (optional)
   * @returns {Promise<QueryResult,StyraRunError>}
   */
  async query(path, input = undefined) {
    const query = input ? {input} : {}

    try {
      const json = toJson(query)
      const decision = await this.apiClient.post(Path.join('data', path), json)
      this.signalEvent(EventType.QUERY, {path, query, decision})
      return fromJson(decision)
    } catch (err) {
      this.signalEvent(EventType.QUERY, {path, query, err})
      throw new StyraRunError('Query failed', err)
    }
  }

  /**
   * @callback DecisionPredicate
   * @param {QueryResult} decision
   * @returns {Boolean} `true` if `decision` is valid, `false` otherwise
   */

  /**
   * Makes an authorization check against a policy rule specified by `path`.
   * Where `path` is the trailing segment of the full request path
   * `"/v1/projects/<USER_ID>/<PROJECT_ID>/envs/<ENVIRONMENT_ID>/data/<PATH>"`
   *
   * The optional `predicate` is a callback that takes the Styra Run check response
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
   * Returns a `Promise` that resolves with `true` if the check was successful, and `false` otherwise.
   * On error, the returned `Promise` is rejected with a {@link StyraRunError}.
   *
   * @param {string} path the path to the policy rule to query
   * @param {*|undefined} input the input document/value for the query (optional)
   * @param {DecisionPredicate|undefined} predicate a callback function, taking a query response dictionary as arg, returning true/false (optional)
   * @returns {Promise<boolean, StyraRunError>}
   */
  async check(path, input = undefined, predicate = defaultPredicate) {
    try {
      const decision = await this.query(path, input)
      const allowed = await predicate(decision)
      this.signalEvent(EventType.CHECK, {allowed, path, input})
      return allowed
    } catch (err) {
      this.signalEvent(EventType.CHECK, {path, input, err})
      throw new StyraRunError('Check failed', err)
    }
  }

  /**
   * Makes an authorization check against a policy rule specified by `path`.
   * Where `path` is the trailing segment of the full request path
   * `"/v1/projects/<USER_ID>/<PROJECT_ID>/envs/<ENVIRONMENT_ID>/data/<PATH>"`
   *
   * The optional `predicate` is a callback that takes the Styra Run check response
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
   * @param {string} path the path to the policy rule to query
   * @param {*|undefined} input the input document for the query
   * @param {DecisionPredicate} predicate a callback function, taking a query response dictionary as arg, returning true/false
   * @returns {Promise<undefined, StyraRunError|StyraRunAssertionError>}
   * @see {@link check}
   */
  async assert(path, input = undefined, predicate = defaultPredicate) {
    try {
      const asserted = await this.check(path, input, predicate)
      this.signalEvent(EventType.ASSERT, {asserted, path, input})
      if (asserted) {
        return
      }
    } catch (err) {
      this.signalEvent(EventType.ASSERT, {asserted: false, path, input, err})
      throw new StyraRunError('Assert failed', err)
    }

    throw new StyraRunAssertionError()
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
   * @param {*} data value to return on asserted
   * @param {string} path the path to the policy rule to query
   * @param {*|undefined} input the input document for the query
   * @param predicate a callback function, taking a response body dictionary as arg, returning true/false
   * @returns {Promise<*, StyraRunError>}
   * @see {@link assert}
   */
  async assertAndReturn(data, path, input = undefined, predicate = defaultPredicate) {
    await this.assert(path, input, predicate)
    return data
  }

  /**
   * @typedef {{path: string, input: *}} BatchQuery
   */

  /**
   * @typedef {{code: string, message: string}} CheckError
   */

  /**
   * @typedef {{check: QueryResult}|{error: CheckError}} BatchCheckItemResult
   */

  /**
   * @typedef {BatchCheckItemResult[]} BatchCheckResult
   */
  /**
   * Makes a batched request of policy rule queries.
   * The provided `items` is a list of objects with the properties:
   *
   * * `path`: the path to the policy rule to query for this entry
   * * `input`: (optional) the input document for this entry
   *
   * If, `input` is provided, it will be applied across all query items.
   *
   * Returns a `Promise` that is resolved to a list of result objects, where each entry corresponds to an entry
   * with the same index in `items`.
   * On error, the returned `Promise` is rejected with a {@link StyraRunError}.
   *
   * @param {BatchQuery[]} items the list of queries to batch
   * @param {*} input the input document to apply to the entire batch request, or `undefined`
   * @returns {Promise<BatchCheckResult, StyraRunError>} a list of result objects
   */
  async batchQuery(items, input = undefined) {
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
        const jsonQuery = toJson(query)
        const jsonResponse = await this.apiClient.post(Path.join('data_batch'), jsonQuery)
        const {result} = fromJson(jsonResponse)
        return result
      } catch (err) {
        this.signalEvent(EventType.BATCH_QUERY, {items, input, err})
        throw new StyraRunError('Batched check failed', err)
      }
    })

    const decisionChunks = await Promise.all(queries)
    const decisions = decisionChunks
      .map((result) => (result !== undefined ? result : []))
      .flat(1)
    this.signalEvent(EventType.BATCH_QUERY, {items, input, decisions})
    return decisions
  }

  /**
   * @callback FilterInputCallback
   * @param {*} item the list item to create an input value for
   * @param {number} index the index of the list item
   */
  /**
   * @callback FilterPathCallback
   * @param {*} item the list item to create an input value for
   * @param {number} index the index of the list item
   */
  /**
   * For each entry in the provided `list`, an authorization check against a policy rule specified by `path` is made.
   * Where `path` is the trailing segment of the full request path
   * `"/v1/projects/${UID}/${PID}/envs/${EID}/data/${path}"`
   *
   * Returns a `Promise` that resolves to a filtered version of the provided `list`.
   * On error, the returned `Promise` is rejected with a {@link StyraRunError}.
   *
   * @param {*[]} list the list to filter
   * @param {DecisionPredicate} predicate the predicate callback to filter each list entry by given a policy decision
   * @param {string|undefined} path the path to the policy rule to query
   * @param {FilterInputCallback} toInput optional, a callback that, given a list entry and an index, should return an `input` document
   * @param {FilterPathCallback} toPath optional, a callback that, given a list entry and an index, should return a `path` string. If provided, overrides the global `path` argument. May return a falsy value to default to the global `path`
   * @returns {Promise<*[], StyraRunError>}
   */
  async filter(list, predicate= defaultPredicate, path = undefined, toInput = undefined, toPath = undefined) {
    if (list.length === 0) {
      return []
    }

    const transformer = (entry, i) => {
      const item = {}

      const itemInput = toInput ? toInput(entry, i) : undefined
      if (itemInput) {
        item.input = itemInput
      }

      const itemPath = toPath ? toPath(entry, i) : undefined
      item.path = itemPath || path
      if (item.path === undefined) {
        throw new StyraRunError(`No 'path' provided for list entry at ${i}`)
      }

      return item
    }

    let decisionList
    try {
      const items = list.map(transformer)
      decisionList = await this.batchQuery(items)
    } catch (err) {
      const error = new StyraRunError('Filtering failed', err)
      this.signalEvent(EventType.FILTER, {list, decisionList, path, err: error})
      throw error
    }

    if (decisionList === undefined || decisionList.length !== list.length) {
      const err = new StyraRunError(`Returned decision list size (${decisionList?.length || 0}) not equal to provided list size (${list.length})`)
      this.signalEvent(EventType.FILTER, {list, decisionList, path, err})
      throw err
    }

    try {
      const filteredList = []
      list.forEach(async (v, i) => {
        if (await predicate(decisionList[i])) {
          filteredList.push(v)
        }
      })
      this.signalEvent(EventType.FILTER, {list, decisionList, filteredList, path})
      return filteredList
    } catch (err) {
      this.signalEvent(EventType.FILTER, {list, decisionList, path, err})
      throw new StyraRunError('Allow filtering failed', err)
    }
  }

  /**
   * @typedef {{result: unknown}} DataResult
   */
  /**
   * Fetch data from the `Styra Run` data API.
   * Where `path` is the trailing segment of the full request path
   * `"/v1/projects/${UID}/${PID}/envs/${EID}/data/${path}"`
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
      const response = fromJson(await this.apiClient.get(Path.join('data', path)))
      this.signalEvent(EventType.GET_DATA, {path, response})
      return response
    } catch (err) {
      this.signalEvent(EventType.GET_DATA, {path, err})
      if (def && err instanceof StyraRunHttpError && err.isNotFoundStatus()) {
        return {result: def}
      }
      throw new StyraRunError('GET data request failed', err)
    }
  }

  /**
   * A Styra Run API response containing the `version` of the updated data.
   *
   * @typedef {{version: number}} DataUpdateResult
   */
  /**
   * Upload data to the `Styra Run` data API.
   * Where `path` is the trailing segment of the full request path
   * `"/v1/projects/${UID}/${PID}/envs/${EID}/data/${path}"`.
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
      const response = fromJson(await this.apiClient.put(Path.join('data', path), json))
      this.signalEvent(EventType.PUT_DATA, {path, data, response})
      return response
    } catch (err) {
      this.signalEvent(EventType.PUT_DATA, {path, data, err})
      throw new StyraRunError('PUT data request failed', err)
    }
  }

  /**
   * Remove data from the `Styra Run` data API.
   * Where `path` is the trailing segment of the full request path
   * `"/v1/projects/${UID}/${PID}/envs/${EID}/data/${path}"`
   *
   * Returns a `Promise` that on a successful response resolves to the Styra Run API {@link DataUpdateResult response body dictionary}: `{"version": ...}`.
   * On error, the returned `Promise` is rejected with a {@link StyraRunError}.
   *
   * @param path the path identifying the data to remove
   * @returns {Promise<DataUpdateResult, StyraRunError>}
   */
  async deleteData(path) {
    try {
      const response = fromJson(await this.apiClient.delete(Path.join('data', path)))
      this.signalEvent(EventType.DELETE_DATA, {path, response})
      return response
    } catch (err) {
      this.signalEvent(EventType.DELETE_DATA, {path, err})
      throw new StyraRunError('DELETE data request failed', err)
    }
  }

  /**
   * A request handler providing a proxy endpoint for use with the Styra Run front-end SDK.
   *
   * @callback ProxyHandler
   * @param {IncomingMessage} request the incoming HTTP request
   * @param {ServerResponse} response the outgoing HTTP response
   */

  /**
   * Returns an HTTP proxy function
   *
   * @param {OnProxyCallback} onProxy callback called for every proxied policy query
   * @returns {ProxyHandler}
   */
  proxy(onProxy = defaultOnProxyHandler) {
    const proxy = new Proxy(this, onProxy)
    return async (request, response) => {
      await proxy.handle(request, response)
    }
  }

  rbacManager() {
    return new RbacManager(this);
  }

  /**
   * A request handler providing an RBAC management endpoint.
   *
   * @callback RbacHandler
   * @param {IncomingMessage} request the incoming HTTP request
   * @param {ServerResponse} response the outgoing HTTP response
   */

  /**
   * Returns an HTTP API function.
   *
   * @param {CreateRbacAuthzInputCallback} createAuthzInput
   * @param {ListRbacUsersCallback} listUsers
   * @param {OnGetRbacUserBindingCallback} onGetRoleBinding
   * @param {OnSetRbacUserBindingCallback} onSetRoleBinding
   * @param {OnDeleteRbacUserBindingCallback} onDeleteRoleBinding
   * @returns {RbacHandler}
   */
  rbacProxy({
               listUsers = defaultRbacUsersCallback,
               createAuthzInput = defaultRbacAuthzInputCallback,
               onGetRoleBinding = defaultRbacOnGetRoleBindingCallback,
               onSetRoleBinding = defaultRbacOnSetRoleBindingCallback,
               onDeleteRoleBinding = defaultRbacOnDeleteRoleBindingCallback,
             }) {
    const manager = new RbacManager(this, {
      listUsers,
      createAuthzInput,
      onGetRoleBinding,
      onSetRoleBinding,
      onDeleteRoleBinding
    })
    return async (request, response) => {
      await manager.handle(request, response)
    }
  }
}

export function defaultPredicate(decision) {
  return decision?.result === true
}

async function defaultRbacUsersCallback(_, __) {
  return []
}

async function defaultRbacOnGetRoleBindingCallback(_, __) {
  return true
}

async function defaultRbacOnSetRoleBindingCallback(_, __, ___) {
  return true
}

async function defaultRbacOnDeleteRoleBindingCallback(_, __) {
  return true
}

async function defaultRbacAuthzInputCallback(_) {
  return {}
}

async function defaultOnProxyHandler(_, __, input) {
  return input
}

/**
 * Construct a new `Styra Run` Client.
 *
 * @param {string} url The `Styra Run` API URL
 * @param {string} token the API key (Bearer token) to use for calls to the `Styra Run` API
 * @param {SdkOptions} options
 * @returns {StyraRunClient}
 * @constructor
 */
export default function New(url, token, options = {}) {
  return new StyraRunClient(url, token, options)
}

export {
  Paginators
}

export {
  RbacManager
}
