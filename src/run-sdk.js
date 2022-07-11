import Http from "http"
import Https from "https"
import Path from "path"

// TODO: Add support for versioning/ETags for data API requests

/**
 * @module StyraRun
 */

/**
 * General Styra Run Client {@link Error}.
 */
export class StyraRunError extends Error {
  constructor(message, path = undefined, query = undefined, cause = undefined) {
    super(message)
    this.name = "StyraRunError"
    this.path = path
    this.query = query
    this.cause = cause
  }
}

/**
 * Error for when the {@link Client#assert} {@link AssertPredicate `predicate`} rejects a policy decision.
 */
export class StyraRunAssertionError extends StyraRunError {
  constructor(path = undefined, query = undefined) {
    super(NOT_ALLOWED, path, query)
    this.name = "StyraRunAssertionError"
  }
}

/**
 * Styra Run Client HTTP {@link Error}.
 */
export class StyraRunHttpError extends Error {
  constructor(message, statusCode, body) {
    super(message)
    this.name = "StyraRunHttpError"
    this.statusCode = statusCode
    this.body = body
  }
}

const OK = 200
const FORBIDDEN = 403

export const NOT_ALLOWED = 'Not allowed!'

export function DEFAULT_PREDICATE(decision) {
  return decision?.result === true
}

/**
 * A client for communicating with the Styra Run API.
 */
export class Client {
  host
  port
  https
  projectId
  environmentId
  userId
  token
  namedCheckFunctions

  constructor({host, port, https, projectId, environmentId, userId, token}) {
    this.host = host ?? "api-test.styra.com"
    this.port = port ?? 443
    this.https = https ?? true
    this.projectId = projectId
    this.environmentId = environmentId
    this.userId = userId
    this.token = token
    this.namedCheckFunctions = {}
  }

  getConnectionOptions() {
    return {
      host: this.host,
      port: this.port,
      https: this.https
    }
  }

  getPathPrefix() {
    return `/v1/projects/${this.userId}/${this.projectId}/envs/${this.environmentId}`
  }

  /**
   * @typedef {{result: unknown}|{}} CheckResult
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
    const reqOpts = {
      ...this.getConnectionOptions(),
      path: Path.join(this.getPathPrefix(), 'data', path),
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `bearer ${this.token}`
      }
    }

    try {
      const json = toJson(query)
      const decission = await request(reqOpts, json)
      return fromJson(decission)
    } catch (err) {
      return await Promise.reject(new StyraRunError('Check failed', path, query, err))
    }
  }


  /**
   * @typedef {{check: CheckResult}} BatchCheckItemResult
   */
  /**
   * @typedef {{result: BatchCheckItemResult[]}} BatchCheckResult
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
    const query = {items}
    if (input) {
      query.input = input
    }

    const reqOpts = {
      ...this.getConnectionOptions(),
      path: Path.join(this.getPathPrefix(), 'data_batch'),
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `bearer ${this.token}`
      }
    }

    try {
      const json = toJson(query)
      const response = await request(reqOpts, json)
      return fromJson(response)
    } catch (err) {
      return await Promise.reject(new StyraRunError('Batched check failed', undefined, query, err))
    }
  }

  /**
   * @callback AssertPredicate
   * @param {CheckResult} decision
   * @returns {Boolean} `true` is `decision` is valide, `false` otherwise
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
   * @returns {Promise<unknown, StyraRunError>}
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
   * @returns {Promise<any[], StyraRunError>}
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
      const batchResult = await this.batchCheck(items)
      resultList = batchResult.result ?? []
    } catch (err) {
      throw new StyraRunError('Allow filtering failed', path, undefined, err)
    }

    if (resultList.length !== list.length) {
      throw new StyraRunError(`Returned result list size (${resultList.length}) not equal to provided list size (${list.length})`,
        path, query, err)
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
    const reqOpts = {
      ...this.getConnectionOptions(),
      path: Path.join(this.getPathPrefix(), 'data', path),
      method: 'GET',
      headers: {
        'authorization': `bearer ${this.token}`
      }
    };

    try {
      const response = await request(reqOpts)
      return fromJson(response)
    } catch (err) {
      if (def && err.resp?.statusCode === 404) {
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
    const reqOpts = {
      ...this.getConnectionOptions(),
      path: Path.join(this.getPathPrefix(), 'data', path),
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${this.token}`
      }
    };

    try {
      const json = toJson(data)
      const response = await request(reqOpts, json)
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
    const reqOpts = {
      ...this.getConnectionOptions(),
      path: Path.join(this.getPathPrefix(), 'data', path),
      method: 'DELETE',
      headers: {
        'authorization': `bearer ${this.token}`
      }
    };

    try {
      const response = await request(reqOpts)
      return fromJson(response)
    } catch (err) {
      return await Promise.reject(new StyraRunError('DELETE data request failed', path, undefined, err))
    }
  }

  /**
   * A callback function
   *
   * @callback NamedCheckCallback
   * @param {Client} client a reference to this {@link Client} instance
   * @param {Object} input the incoming `input` document
   * @returns {Promise<unknown>}
   */
  /**
   * Register a named check function.
   *
   * @param {NamedCheckCallback} name the name of the check function
   * @param onCheck callback returning a `Promise` resolving to the check result body
   */
  registerNamedCheck(name, onCheck) {
    this.namedCheckFunctions[name] = onCheck
  }

  /**
   * Calls a {@link NamedCheckCallback named check function}, if found.
   *
   * Returns a `Promise`, resolving to the result of calling the named function.
   * On error, the returned `Promise` is rejected with a {@link StyraRunError}.
   *
   * @param name the name of the check function
   * @param input the input document to pass to the check function
   * @returns {Promise<*>}
   */
  async callNamedCheck(name, input) {
    const namedCheck = this.namedCheckFunctions[name]

    if (namedCheck) {
      try {
        return await namedCheck(this, input)
      } catch (err) {
        throw new StyraRunError(`Named check function '${name}' failed`, undefined, err)
      }
    }

    throw new StyraRunError(`Named check function '${name}' not found`)
  }

  /**
   * Returns an HTTP proxy function
   *
   * @param onProxy
   * @returns {(Function(*, *): Promise)}
   */
  proxy(onProxy = undefined) {
    return async (request, response) => {
      try {
        if (request.method !== 'POST') {
          response.writeHead(405, {'Content-Type': 'text/html'})
          response.end('Method Not Allowed!')
          return
        }

        const body = await getBody(request)
        const json = fromJson(body)

        const checkName = json?.check
        const path = json?.path

        if (checkName === undefined && path === undefined) {
          response.writeHead(400, {'Content-Type': 'text/html'})
          response.end('check or path required')
          return
        }

        let input = json?.input ?? {}
        if (onProxy) {
          input = await onProxy(request, response, input)
        }

        let checkResult
        if (checkName) {
          checkResult = await this.callNamedCheck(checkName, input)
        } else {
          checkResult = await this.check(path, input)
        }
        const result = toJson(checkResult)

        response.writeHead(200, {'Content-Type': 'application/json'})
          .end(result)
      } catch (e) {
        response.writeHead(500, {'Content-Type': 'text/html'})
        response.end('policy check failed')
      }
    }
  }
}

function getBody(stream) {
  return new Promise((resolve, reject) => {
    if (stream.body) {
      // express compatibility
      resolve(stream.body)
    } else {
      var body = ''
      stream.on('data', (data) => {
        body += data
      })
      stream.on('end', () => {
        resolve(body)
      })
    }
  })
}

/**
 * Construct a new `Styra Run` Client from the passed `options` dictionary.
 * Valid options are:
 * * `host`: (string) The `Styra Run` API host name
 * * `port`: (number) The `Styra Run` API port
 * * `https`: (boolean) Whether to use TLS for calls to the `Styra Run` API (default: true)
 * * `projectId`: (string) Project ID
 * * `environmentId`: (string) Environment ID
 * * `userId`: (string) User ID
 * * `token`: (string) the API key (Bearer token) to use for calls to the `Styra Run` API
 *
 * @param options
 * @returns {Client}
 * @constructor
 */
function New(options) {
  return new Client(options);
}

function request(options, data) {
  return new Promise((resolve, reject) => {
    try {
      const client = options.https === false ? Http : Https
      const req = client.request(options, async (response) => {
        let body = await getBody(response);
        switch (response.statusCode) {
          case OK:
            resolve(body);
            break;
          default:
            reject(new StyraRunHttpError(`Unexpected status code: ${response.statusCode}`,
              response.statusCode, body));
        }
      }).on('error', (err) => {
        reject(new Error('Failed to send request', {
          cause: err
        }))
      })
      if (data) {
        req.write(data);
      }
      req.end()
    } catch (err) {
      reject(new Error('Failed to send request', {
        cause: err
      }))
    }
  })
}

function toJson(data) {
  const json = JSON.stringify(data);
  if (json) {
    return json
  } else {
    throw new Error('JSON serialization produced undefined result')
  }
}

function fromJson(val) {
  if (typeof val === 'object') {
    return val
  }
  try {
    return JSON.parse(val)
  } catch (err) {
    throw new Error('Invalid JSON', {cause: err})
  }
}

export default {
  New
}